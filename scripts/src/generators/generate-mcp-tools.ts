// MCP tool registry generator. Reads the live OpenAPI 3.1 spec via
// `app.request('/openapi.json')` against a booted-with-stub-deps
// apps/local-api Hono app; walks every route with `'x-mcp': { exposed:
// true, name, description }`; emits `apps/mcp/src/generated/
// api-tools.ts` as a typed `McpToolFactory[]`.
//
// Mirrors the `generate-sdk.ts` precedent (the app-request-spec-
// trick letterman locked).
//
// Per `docs/blueprints/mcp/blueprint.md §4` + `coding.md §6` +
// `decisions.md` D1 + D2 + D3 + D5 + D7 + D12.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp, type CreateAppOptions } from '@vynel/local-api/app'

// scripts/src/generators/ -> repo root.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const outputDir = path.join(repoRoot, 'apps', 'mcp', 'src', 'generated')
const outputPath = path.join(outputDir, 'api-tools.ts')

// ---------------------------------------------------------------------------
// OpenAPI types we care about (loose; we only read the subset we emit).
// ---------------------------------------------------------------------------

type OpenApiParameter = {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: OpenApiSchema
}

type OpenApiSchema = {
  type?: string | string[]
  enum?: readonly (string | number | boolean)[]
  items?: OpenApiSchema
}

type XMcp = {
  exposed: boolean
  name: string
  description: string
  // D7: mutating tools require an explicit per-route approval flag.
  // Spelling deferred to first-mutating-tool per Q8; the generator
  // currently rejects ANY non-GET method, which is the safest gate.
  mutatingApproved?: boolean
  // Route this tool to the GLOBAL-ROOT ("brain") surface instead of the
  // workspace surface. The default split is path-based (`/routing/*`); a
  // user-scoped brain tool that doesn't live under `/routing/` (e.g. creating a
  // workspace) opts in here so it lands in `generatedRoutingMcpTools`.
  rootSurface?: boolean
  // ALSO expose this tool on WORKSPACE INTERACTIVE chat streams (session-library
  // Slice ④b): the tool keeps whatever surface the path/rootSurface split gives
  // it AND joins `generatedWorkspaceInteractiveMcpTools` — which only the
  // interactive workspace chat stream attaches (via
  // `vynelWorkspaceInteractiveDescriptor`). Background workspace turns (schedule
  // fires, delegated runs) compose the plain workspace descriptor and never see
  // these tools.
  workspaceInteractiveSurface?: boolean
}

type OpenApiObjectSchema = {
  type?: 'object'
  properties?: Record<string, OpenApiSchema>
  required?: string[]
}

type OpenApiRequestBody = {
  content?: {
    'application/json'?: {
      schema?: OpenApiObjectSchema
    }
  }
}

type OpenApiOperation = {
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  'x-mcp'?: XMcp
}

// ---------------------------------------------------------------------------
// Boot the api app + dispatch /openapi.json (the app-request-spec-trick).
// ---------------------------------------------------------------------------

const stubDeps = {} as unknown as CreateAppOptions
const app = createApp(stubDeps)
const specResponse = await app.request('/openapi.json')
if (!specResponse.ok) {
  const body = await specResponse.text()
  throw new Error(`[mcp:generate] /openapi.json returned ${specResponse.status}: ${body}`)
}
const spec = (await specResponse.json()) as Record<string, unknown>
const paths = (spec['paths'] ?? {}) as Record<string, Record<string, OpenApiOperation>>

// ---------------------------------------------------------------------------
// Walk paths × methods, collect exposed entries.
// ---------------------------------------------------------------------------

type BodyField = {
  name: string
  required: boolean
  schema: OpenApiSchema
}

type ToolEntry = {
  name: string // x-mcp.name (snake_case)
  exportName: string // camelCase ts identifier
  description: string
  method: string // GET / POST / PATCH / DELETE
  pathTemplate: string // e.g. /workspaces/{workspaceId}/memory/entries
  pathParams: OpenApiParameter[]
  queryParams: OpenApiParameter[]
  bodyFields: BodyField[] // empty for GETs; populated for mutating tools (D7)
  isMutating: boolean
  // Routing tools (path under `/routing/`, agent-base Slice 4) are kept in a
  // SEPARATE array so the normal chat turn's server stays byte-for-byte; only the
  // GLOBAL-ROOT turn's server gets them.
  isRouting: boolean
  // Slice ④b: additionally emitted into `generatedWorkspaceInteractiveMcpTools`.
  isWorkspaceInteractive: boolean
}

const entries: ToolEntry[] = []
for (const [pathKey, methods] of Object.entries(paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    const mcp = operation['x-mcp']
    if (!mcp || mcp.exposed !== true) continue

    // D7: mutating tools NOT emitted unless the route explicitly opts
    // in via `x-mcp.mutatingApproved: true` (spelling locked at Q8
    // resolution 2026-05-25 — `mutatingApproved`). Throw loud so a
    // future contributor flipping `exposed: true` on a POST without
    // the approval flag gets a CI failure instead of a silently-
    // shipped mutating tool.
    const upperMethod = method.toUpperCase()
    const isMutating = upperMethod !== 'GET'
    if (isMutating && mcp.mutatingApproved !== true) {
      throw new Error(
        `[mcp:generate] mutating tool '${mcp.name}' (${upperMethod} ${pathKey}) ` +
          `requires explicit x-mcp.mutatingApproved=true per D7; refusing to emit.`,
      )
    }

    const allParams = operation.parameters ?? []
    const bodySchema = operation.requestBody?.content?.['application/json']?.schema
    const bodyFields: BodyField[] = []
    if (bodySchema?.properties) {
      const requiredSet = new Set(bodySchema.required ?? [])
      for (const [name, sch] of Object.entries(bodySchema.properties)) {
        bodyFields.push({ name, required: requiredSet.has(name), schema: sch })
      }
    }

    entries.push({
      name: mcp.name,
      exportName: snakeToCamel(mcp.name),
      description: mcp.description,
      method: upperMethod,
      pathTemplate: pathKey,
      pathParams: allParams.filter((p) => p.in === 'path'),
      queryParams: allParams.filter((p) => p.in === 'query'),
      bodyFields,
      isMutating,
      isRouting: pathKey.startsWith('/routing/') || mcp.rootSurface === true,
      isWorkspaceInteractive: mcp.workspaceInteractiveSurface === true,
    })
  }
}

// Stable order across regenerations — by tool name. Without this, a
// route file rename or `for...in` reorder could churn the snapshot.
entries.sort((a, b) => a.name.localeCompare(b.name))

// ---------------------------------------------------------------------------
// Emit the registry file.
// ---------------------------------------------------------------------------

const fileSource = renderFile(entries)
mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, fileSource)
// eslint-disable-next-line no-console
console.log(
  `[mcp:generate] wrote ${path.relative(repoRoot, outputPath)} ` +
    `(${entries.length} tool${entries.length === 1 ? '' : 's'})`,
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function openApiToZodSource(schema: OpenApiSchema | undefined): string {
  if (!schema) return 'z.any()'
  if (schema.enum && schema.enum.length > 0) {
    const opts = schema.enum
      .map((v) => (typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : String(v)))
      .join(', ')
    return `z.enum([${opts}])`
  }
  // Nullable shape: `type: ['string', 'null']`.
  if (Array.isArray(schema.type)) {
    if (schema.type.includes('null')) {
      const otherType = schema.type.find((t) => t !== 'null') ?? 'unknown'
      return `${zodFromPrimitive(otherType, schema)}.nullable()`
    }
    return 'z.any()'
  }
  return zodFromPrimitive(schema.type ?? 'unknown', schema)
}

function zodFromPrimitive(t: string, schema: OpenApiSchema): string {
  switch (t) {
    case 'string':
      return 'z.string()'
    case 'number':
    case 'integer':
      return 'z.number()'
    case 'boolean':
      return 'z.boolean()'
    case 'array':
      return `z.array(${openApiToZodSource(schema.items)})`
    case 'object':
      return 'z.record(z.unknown())'
    default:
      return 'z.any()'
  }
}

function renderToolEntry(entry: ToolEntry): string {
  const schemaLines: string[] = []
  for (const p of entry.pathParams) {
    schemaLines.push(`    ${p.name}: ${openApiToZodSource(p.schema)},`)
  }
  for (const p of entry.queryParams) {
    const base = openApiToZodSource(p.schema)
    const optional = p.required === true ? '' : '.optional()'
    schemaLines.push(`    ${p.name}: ${base}${optional},`)
  }
  // Body fields (mutating tools only): each field becomes a top-level
  // tool arg; the handler re-collects them into the JSON body at call
  // time. Required-set comes from `requestBody.content.application/json.schema.required`.
  for (const f of entry.bodyFields) {
    const base = openApiToZodSource(f.schema)
    const optional = f.required ? '' : '.optional()'
    schemaLines.push(`    ${f.name}: ${base}${optional},`)
  }
  const schemaBlock = schemaLines.length > 0 ? `{\n${schemaLines.join('\n')}\n  }` : '{}'

  const pathBuildSource = buildPathSource(entry)
  const queryBuildSource = buildQuerySource(entry)
  const bodyBuildSource = buildBodySource(entry)
  const requestInitSource = buildRequestInitSource(entry)
  // Mutating tools advertise destructive intent + drop readOnlyHint so
  // the SDK doesn't batch-parallelize them with read-only tools.
  const annotationsSource = entry.isMutating
    ? `{ annotations: { readOnlyHint: false, destructiveHint: true } }`
    : `{ annotations: { readOnlyHint: true } }`

  return `export const ${entry.exportName}: McpToolFactory = (scope, app) =>
  (tool as unknown as McpToolFn)(
    '${entry.name}',
    ${JSON.stringify(entry.description)},
    ${schemaBlock},
    async (args: Record<string, unknown>) => {
      try {
${pathBuildSource}
${queryBuildSource}
${bodyBuildSource}
        const url = pathStr + (queryStr ? '?' + queryStr : '')
        const response = await app(url, ${requestInitSource})
        const bodyText = await response.text()
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: \`Error \${response.status}: \${bodyText}\` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: bodyText }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    ${annotationsSource},
  )`
}

function buildBodySource(entry: ToolEntry): string {
  if (entry.bodyFields.length === 0) {
    return `        const requestBody: string | undefined = undefined`
  }
  const names = entry.bodyFields.map((f) => `'${f.name}'`).join(', ')
  // Ambient workspace grounding (Slice ④b) — mirrors buildPathSource's
  // `scope.workspaceId` fallback: on the workspace surface a `workspaceId` body
  // field is stamped from the turn's own scope when the model omits it, so a
  // workspace-spawned call inherits its creator's ground without the model
  // needing to know the id. On the root surface `scope.workspaceId` is absent
  // and the field stays omitted (the shipped global behavior).
  const workspaceFallback = entry.bodyFields.some((f) => f.name === 'workspaceId')
    ? `\n        if (bodyObj['workspaceId'] === undefined && scope.workspaceId !== undefined) {
          bodyObj['workspaceId'] = scope.workspaceId
        }`
    : ''
  return `        const bodyObj: Record<string, unknown> = {}
        for (const k of [${names}]) {
          if (args[k] !== undefined) bodyObj[k] = args[k]
        }${workspaceFallback}
        const requestBody = JSON.stringify(bodyObj)`
}

function buildRequestInitSource(entry: ToolEntry): string {
  if (entry.bodyFields.length === 0) {
    return `{ method: '${entry.method}' }`
  }
  return `{ method: '${entry.method}', headers: { 'content-type': 'application/json' }, body: requestBody }`
}

function buildPathSource(entry: ToolEntry): string {
  // safe: the regex has exactly one required capture group, so every
  // match's `m[1]` is present (the `!` clears noUncheckedIndexedAccess).
  const placeholders = Array.from(entry.pathTemplate.matchAll(/\{([^}]+)\}/g)).map((m) => m[1]!)
  if (placeholders.length === 0) {
    return `        const pathStr = '${entry.pathTemplate}'`
  }
  const lines: string[] = []
  lines.push(`        let pathStr = '${entry.pathTemplate}'`)
  for (const ph of placeholders) {
    const fallback =
      ph === 'workspaceId' ? `args['${ph}'] ?? scope.workspaceId ?? ''` : `args['${ph}'] ?? ''`
    lines.push(
      `        pathStr = pathStr.replace('{${ph}}', encodeURIComponent(String(${fallback})))`,
    )
  }
  return lines.join('\n')
}

function buildQuerySource(entry: ToolEntry): string {
  if (entry.queryParams.length === 0) {
    return `        const queryStr = ''`
  }
  const names = entry.queryParams.map((p) => `'${p.name}'`).join(', ')
  return `        const queryParams = new URLSearchParams()
        for (const k of [${names}]) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }
        const queryStr = queryParams.toString()`
}

function renderFile(allEntries: ToolEntry[]): string {
  const header = `// GENERATED — DO NOT EDIT
//
// Auto-emitted by \`scripts/src/generators/generate-mcp-tools.ts\` from
// the OpenAPI 3.1 spec at \`apps/local-api\`'s \`/openapi.json\`.
// Regenerate via \`pnpm api:generate\`. Drift is caught by
// \`scripts/src/generators/check-mcp-parity.ts\` (CI guard).
//
// To add a tool: add \`'x-mcp': { exposed: true, name, description }\`
// to the route's \`describeRoute({...})\` in \`apps/local-api/src/routes/\`,
// then run \`pnpm api:generate\`. NEVER hand-edit this file.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFactory } from '../mcp-types.js'

// The Claude Agent SDK's \`tool()\` is overloaded; we widen at the
// call site so the emitter doesn't need to know the exact generic
// shape (per the generator's renderToolEntry pattern).
type McpToolFn = (
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
  }>,
  options?: {
    annotations?: {
      readOnlyHint?: boolean
      destructiveHint?: boolean
      idempotentHint?: boolean
      openWorldHint?: boolean
    }
  },
) => unknown

`
  const body = allEntries.map(renderToolEntry).join('\n\n')
  const nonRouting = allEntries.filter((e) => !e.isRouting)
  const routing = allEntries.filter((e) => e.isRouting)
  const workspaceInteractive = allEntries.filter((e) => e.isWorkspaceInteractive)
  const footer =
    `\n\n// Workspace-scoped tools — the normal chat turn's in-process server.\n` +
    `export const generatedMcpTools: McpToolFactory[] = [\n${nonRouting
      .map((e) => `  ${e.exportName},`)
      .join('\n')}\n]\n` +
    `\n// Routing tools (agent-base Slice 4) — the GLOBAL-ROOT turn's server ONLY.\n` +
    `// Kept OUT of generatedMcpTools so the normal chat turn stays byte-for-byte.\n` +
    `export const generatedRoutingMcpTools: McpToolFactory[] = [\n${routing
      .map((e) => `  ${e.exportName},`)
      .join('\n')}\n]\n` +
    `\n// Session-library Slice ④b — tools ALSO exposed on WORKSPACE INTERACTIVE\n` +
    `// chat streams (x-mcp.workspaceInteractiveSurface). Only the interactive\n` +
    `// stream's descriptor composes this array; background workspace turns\n` +
    `// (schedule fires, delegated runs) never see it.\n` +
    `export const generatedWorkspaceInteractiveMcpTools: McpToolFactory[] = [\n${workspaceInteractive
      .map((e) => `  ${e.exportName},`)
      .join('\n')}\n]\n`
  return header + body + footer
}
