// The external (stdio) MCP server — direction ②. A GENERIC `McpServer`
// that reads the committed OpenAPI spec, registers every `x-mcp.exposed`
// route as a tool (Zod input built from its params), and dispatches each
// call to the api over HTTP. Provider-neutral (`@modelcontextprotocol/sdk`;
// the amended AI-seam invariant permits MCP builder primitives in this layer).
//
// Runtime-sourced from `@vynel/sdk`'s `openapi.json` — no codegen, and it
// CANNOT drift (the spec is regenerated + guarded by `check-sdk-parity`).
// Curation MIRRORS the agent-bound registry (`scripts/.../generate-mcp-tools.ts`):
// only `exposed === true`, and a mutating tool requires `mutatingApproved`
// (the committed spec only carries routes that already passed that gate — this
// is defense-in-depth).
//
// The Zod-shape builder here parallels `openApiToZodSource` in
// `generate-mcp-tools.ts`: that EMITS Zod source strings for direction ③;
// this BUILDS live Zod objects for direction ②. Kept separate per CLAUDE.md
// "simplicity over DRY-that-contorts" — a string-emitter and an object-builder
// don't share cleanly.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z, type ZodTypeAny } from 'zod'

// The HTTP dispatch surface — the adapter injects a fetch-based one; tests
// inject a stub. `url` is a path (+ query); the impl prefixes the api base URL.
export type FetchDispatch = (url: string, init?: RequestInit) => Promise<Response>

// Structural subset of the OpenAPI 3.1 spec we read (the committed spec is a
// superset; the adapter casts it to this at the boundary).
interface OpenApiSchema {
  type?: string | string[]
  enum?: readonly (string | number | boolean)[]
  items?: OpenApiSchema
}
interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  schema?: OpenApiSchema
}
interface OpenApiBodySchema {
  properties?: Record<string, OpenApiSchema>
  required?: string[]
}
interface OpenApiOperation {
  parameters?: OpenApiParameter[]
  requestBody?: { content?: { 'application/json'?: { schema?: OpenApiBodySchema } } }
  'x-mcp'?: { exposed: boolean; name: string; description: string; mutatingApproved?: boolean }
}
export interface OpenApiSpec {
  paths: Record<string, Record<string, OpenApiOperation>>
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

// A transport-level backstop, not a per-route budget: every exposed route bounds
// its own slow work internally, so this only has to outlast the slowest of them
// — `create_session`, whose priming drain is capped at 120s
// (`runSeededSwapSession`). Keep this ABOVE that cap, or a legitimate spawn
// would read as a timeout.
const DISPATCH_TIMEOUT_MS = 150_000

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

// One resolved tool, ready to register — kept as a plain value (not tied to
// `McpServer`) so tests assert the set + drive `handler` against a stub
// dispatch without poking server internals.
export interface ExternalTool {
  name: string
  description: string
  inputSchema: Record<string, ZodTypeAny>
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean }
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
}

export function collectExternalTools(spec: OpenApiSpec, dispatch: FetchDispatch): ExternalTool[] {
  const tools: ExternalTool[] = []

  for (const [pathTemplate, methods] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = methods[method]
      const mcp = operation?.['x-mcp']
      if (!operation || !mcp || mcp.exposed !== true) continue

      const upperMethod = method.toUpperCase()
      const isMutating = upperMethod !== 'GET'
      // Mirror generate-mcp-tools.ts's D7 gate: a mutating tool must be
      // explicitly approved. (Defense-in-depth — the committed spec only
      // carries routes that already passed that generator's gate.)
      if (isMutating && mcp.mutatingApproved !== true) continue

      tools.push({
        name: mcp.name,
        description: mcp.description,
        inputSchema: buildInputShape(operation),
        annotations: isMutating
          ? { readOnlyHint: false, destructiveHint: true }
          : { readOnlyHint: true },
        handler: makeHandler(pathTemplate, upperMethod, operation, dispatch),
      })
    }
  }

  // Stable order (by tool name) — matches the agent-bound registry's emit.
  return tools.sort((a, b) => a.name.localeCompare(b.name))
}

export function buildExternalMcpServer(
  spec: OpenApiSpec,
  dispatch: FetchDispatch,
  options: {
    /** Full `mcp__vynel__<tool>`-style names the admin DISABLED — skipped at
     *  registration so this surface honors the kill-switch like every session
     *  surface does. Tier stays call-time here (the HTTP featureGate). */
    disabledToolNames?: ReadonlySet<string>
  } = {},
): McpServer {
  const server = new McpServer({ name: 'vynel', version: '1.0.0' })
  for (const tool of collectExternalTools(spec, dispatch)) {
    if (options.disabledToolNames?.has(`mcp__vynel__${tool.name}`) === true) continue
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      tool.handler,
    )
  }
  return server
}

// Build the tool's Zod input shape from the operation's path + query params
// and its JSON body fields. Path params are always required.
function buildInputShape(operation: OpenApiOperation): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {}

  for (const param of operation.parameters ?? []) {
    if (param.in !== 'path' && param.in !== 'query') continue
    const base = openApiToZod(param.schema)
    shape[param.name] = param.required === true ? base : base.optional()
  }

  const bodySchema = operation.requestBody?.content?.['application/json']?.schema
  if (bodySchema?.properties) {
    const requiredSet = new Set(bodySchema.required ?? [])
    for (const [name, sch] of Object.entries(bodySchema.properties)) {
      const base = openApiToZod(sch)
      shape[name] = requiredSet.has(name) ? base : base.optional()
    }
  }

  return shape
}

function openApiToZod(schema: OpenApiSchema | undefined): ZodTypeAny {
  if (!schema) return z.unknown()
  if (schema.enum && schema.enum.length > 0) {
    const strings = schema.enum.filter((v): v is string => typeof v === 'string')
    if (strings.length === schema.enum.length && strings.length > 0) {
      return z.enum(strings as [string, ...string[]])
    }
  }
  if (Array.isArray(schema.type)) {
    if (schema.type.includes('null')) {
      const other = schema.type.find((t) => t !== 'null') ?? 'unknown'
      return zodFromPrimitive(other, schema).nullable()
    }
    return z.unknown()
  }
  return zodFromPrimitive(schema.type ?? 'unknown', schema)
}

function zodFromPrimitive(type: string, schema: OpenApiSchema): ZodTypeAny {
  switch (type) {
    case 'string':
      return z.string()
    case 'number':
    case 'integer':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(openApiToZod(schema.items))
    case 'object':
      return z.record(z.unknown())
    default:
      return z.unknown()
  }
}

// Build the tool handler: fill the path template + query from args, attach a
// JSON body for mutating tools, dispatch, and shape the result. Any non-2xx
// or thrown error becomes an `isError` text result (MCP surfaces it to the
// caller rather than crashing the server).
//
// Every dispatch carries a deadline. This is real HTTP to the api, so the
// signal genuinely CANCELS the request — an unreachable or wedged api would
// otherwise park the calling MCP client on a promise that never settles, and
// an outside client (unlike a Vynel turn) has no reaper behind it. The abort
// surfaces as a normal `isError` result the model can read and act on.
function makeHandler(
  pathTemplate: string,
  method: string,
  operation: OpenApiOperation,
  dispatch: FetchDispatch,
): (args: Record<string, unknown>) => Promise<ToolResult> {
  const pathParamNames = [...pathTemplate.matchAll(/\{([^}]+)\}/g)].map(
    // safe: each match of the group regex has capture group 1 present.
    (m) => m[1]!,
  )
  const queryParamNames = (operation.parameters ?? [])
    .filter((p) => p.in === 'query')
    .map((p) => p.name)
  const bodyFieldNames = Object.keys(
    operation.requestBody?.content?.['application/json']?.schema?.properties ?? {},
  )

  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      let path = pathTemplate
      for (const name of pathParamNames) {
        path = path.replace(`{${name}}`, encodeURIComponent(String(args[name] ?? '')))
      }

      const query = new URLSearchParams()
      for (const name of queryParamNames) {
        const value = args[name]
        if (value !== undefined && value !== null) query.set(name, String(value))
      }
      const queryString = query.toString()
      const url = path + (queryString ? `?${queryString}` : '')

      const signal = AbortSignal.timeout(DISPATCH_TIMEOUT_MS)
      let init: RequestInit = { method, signal }
      if (method !== 'GET' && bodyFieldNames.length > 0) {
        const body: Record<string, unknown> = {}
        for (const name of bodyFieldNames) {
          if (args[name] !== undefined) body[name] = args[name]
        }
        init = {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        }
      }

      const response = await dispatch(url, init)
      const text = await response.text()
      if (!response.ok) {
        return { content: [{ type: 'text', text: `Error ${response.status}: ${text}` }], isError: true }
      }
      return { content: [{ type: 'text', text }] }
    } catch (err) {
      // An abort reads as "This operation was aborted" — useless to the model.
      // Name what actually happened so it can decide to retry or report.
      const isTimeout = err instanceof Error && err.name === 'TimeoutError'
      const text = isTimeout
        ? `The request timed out after ${DISPATCH_TIMEOUT_MS}ms — the Vynel api did not respond. Report this rather than retrying immediately.`
        : err instanceof Error
          ? err.message
          : String(err)
      return { content: [{ type: 'text', text }], isError: true }
    }
  }
}
