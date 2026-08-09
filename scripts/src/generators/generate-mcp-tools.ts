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
  // A nullable zod enum reaches the spec as an enum WITH a null member.
  enum?: readonly (string | number | boolean | null)[]
  items?: OpenApiSchema
}

type XMcp = {
  exposed: boolean
  name: string
  description: string
  // D7: mutating tools require an explicit per-route approval flag.
  // Spelling deferred to first-mutating-tool per Q8; the generator
  // currently rejects ANY non-GET method, which is the safest gate.
  //
  // `mutatingApproved` means ONLY "may be emitted as a tool" — it says nothing
  // about approval cards. The card question is answered separately: a
  // DELETE-method route (or one flagged `askApproval`) joins the emitted
  // ask-mode approval set below. Keeping the two meanings apart is deliberate —
  // bulk-exposing routes must never silently widen the uncarded surface.
  mutatingApproved?: boolean
  // Card this tool in ASK mode even though its method is not DELETE. DELETE
  // routes join the ask-approval set automatically (Chad's stance 2026-07-26:
  // approval is for "DELETE and anything destructive"); this flag opts in a
  // non-DELETE route — a POST/PATCH that destroys state, or one Chad wants
  // carded regardless (register_workspace).
  askApproval?: boolean
  // Body fields the emitted tool must NOT advertise or forward (e.g. a
  // user-supplied-secrets field that exists for the UI surface only) — the
  // structural "secrets never transit chat" guard. The route validates
  // for every surface regardless.
  excludedBodyFields?: string[]
  // Route this tool to the GLOBAL-ROOT ("brain") surface instead of the
  // workspace surface. The default split is path-based (`/routing/*`); a
  // user-scoped brain tool that doesn't live under `/routing/` (e.g. creating a
  // workspace) opts in here so it lands in `generatedRoutingMcpTools`.
  // Explicit FALSE opts a `/routing/*` route OUT of the root surface — it then
  // lands in the plain workspace array instead (session-comms:
  // `report_to_requester` rides background workspace/session turns, and the
  // global root — which has no requester — must never see it).
  rootSurface?: boolean
  // ALSO expose this tool on WORKSPACE-ROOT turns that may route work onward
  // (session-library Slice ④b, widened 2026-07-21): the tool keeps whatever
  // surface the path/rootSurface split gives it AND joins
  // `generatedWorkspaceInteractiveMcpTools` — attached by the interactive chat
  // stream AND delegated workspace-root runs (via
  // `vynelWorkspaceInteractiveDescriptor`). Schedule fires and spawned-session
  // targets compose the plain workspace descriptor and never see these tools.
  workspaceInteractiveSurface?: boolean
  // ALSO keep this tool in the plain workspace array even though it is a ROOT
  // tool. Routing and workspace are otherwise MUTUALLY EXCLUSIVE
  // (`nonRouting = !isRouting`), which means one route cannot serve both the
  // global root and the turns that read the plain array (schedule fires,
  // spawned sessions, delegated workspace roots). That is fine for a tool that
  // is genuinely root-only, and wrong for one that every session needs — a
  // unified comms tool must have ONE name everywhere, or the model has to pick
  // between near-identical tools and picking wrong is a silent misroute.
  //
  // Safe because the generator emits one factory per entry and the arrays only
  // REFERENCE it — an entry in both arrays is the same export twice, never a
  // duplicate declaration.
  workspaceSurface?: boolean
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
  // DELETE-method or `x-mcp.askApproval` — joins `generatedAskModeApprovalToolNames`.
  isAskApproval: boolean
  // Routing tools (path under `/routing/`, agent-base Slice 4) are kept in a
  // SEPARATE array so the normal chat turn's server stays byte-for-byte; only the
  // GLOBAL-ROOT turn's server gets them.
  isRouting: boolean
  // Slice ④b: additionally emitted into `generatedWorkspaceInteractiveMcpTools`.
  isWorkspaceInteractive: boolean
  isWorkspaceSurface: boolean
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
    const excludedBodyFields = new Set(mcp.excludedBodyFields ?? [])
    const bodyFields: BodyField[] = []
    if (bodySchema?.properties) {
      const requiredSet = new Set(bodySchema.required ?? [])
      for (const [name, sch] of Object.entries(bodySchema.properties)) {
        // Excluded fields never reach the tool schema — the emitted zod
        // object then strips a model-invented value before the HTTP call
        // (the structural "secrets never transit chat" guard).
        if (excludedBodyFields.has(name)) continue
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
      isAskApproval: upperMethod === 'DELETE' || mcp.askApproval === true,
      isRouting:
        (pathKey.startsWith('/routing/') && mcp.rootSurface !== false) || mcp.rootSurface === true,
      isWorkspaceInteractive: mcp.workspaceInteractiveSurface === true,
      isWorkspaceSurface: mcp.workspaceSurface === true,
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
    // `z.enum([...]).nullable()` reaches the spec as an enum WITH a null
    // member — emitting that null into `z.enum` is invalid source. Strip it
    // and restore the nullability on the emitted schema instead.
    const nullable = schema.enum.includes(null)
    const values = schema.enum.filter((v): v is string | number | boolean => v !== null)
    if (values.length === 0) return 'z.null()'
    const opts = values
      .map((v) => (typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : String(v)))
      .join(', ')
    return `z.enum([${opts}])${nullable ? '.nullable()' : ''}`
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
  // Ambient workspace grounding for QUERY params — buildBodySource's
  // `scope.workspaceId` mirror. Without it, a workspace turn calling
  // list_agents/get_agent with `workspaceId` omitted silently gets USER-scope
  // rows only (the model generally does not know its ambient workspace id —
  // that is the whole point of the stamp). On the root surface
  // `scope.workspaceId` is absent and the param stays omitted.
  const workspaceFallback = entry.queryParams.some((p) => p.name === 'workspaceId')
    ? `\n        if (!queryParams.has('workspaceId') && scope.workspaceId !== undefined) {
          queryParams.set('workspaceId', scope.workspaceId)
        }`
    : ''
  return `        const queryParams = new URLSearchParams()
        for (const k of [${names}]) {
          const v = args[k]
          if (v !== undefined && v !== null) queryParams.set(k, String(v))
        }${workspaceFallback}
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
  // A routing tool opts back INTO the workspace array with `workspaceSurface`.
  const nonRouting = allEntries.filter((e) => !e.isRouting || e.isWorkspaceSurface)
  const routing = allEntries.filter((e) => e.isRouting)
  const workspaceInteractive = allEntries.filter((e) => e.isWorkspaceInteractive)
  const askApproval = allEntries.filter((e) => e.isAskApproval)
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
    `\n// Session-library Slice ④b (widened 2026-07-21) — tools ALSO exposed on\n` +
    `// workspace-root turns (x-mcp.workspaceInteractiveSurface): the interactive\n` +
    `// chat stream AND delegated workspace-root runs compose this array; schedule\n` +
    `// fires and spawned-session targets never see it.\n` +
    `export const generatedWorkspaceInteractiveMcpTools: McpToolFactory[] = [\n${workspaceInteractive
      .map((e) => `  ${e.exportName},`)
      .join('\n')}\n]\n` +
    `\n// The ask-approval tier — DELETE-method routes + x-mcp.askApproval opt-ins.\n` +
    `// Fed into the descriptors' askModeApprovalToolNames: these card ONLY in ask\n` +
    `// mode (auto/bypass run them uncarded). Full tool names under the 'vynel'\n` +
    `// server prefix, matching the descriptor layer's hardcoded server name.\n` +
    `export const generatedAskModeApprovalToolNames: string[] = [\n${askApproval
      .map((e) => `  'mcp__vynel__${e.name}',`)
      .join('\n')}\n]\n`
  return header + body + footer
}
