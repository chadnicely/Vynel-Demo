// Types describing the openapi.json shape we consume + the internal
// model the generator builds + emits from. Kept in one file so the
// parse / tree / emit modules share a single source of truth.

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export const HTTP_METHODS: ReadonlyArray<HttpMethod> = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
]

export interface OpenApiParameter {
  in: 'path' | 'query' | 'header' | 'cookie'
  name: string
  required?: boolean
}

export interface OpenApiOperation {
  'x-sdk-name'?: string
  parameters?: OpenApiParameter[]
  requestBody?: {
    content?: Record<string, unknown>
    required?: boolean
  }
  responses?: Record<string, { content?: Record<string, unknown> }>
}

export interface OpenApiSpec {
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
}

/**
 * One operation lifted from the spec, ready to emit. All the decisions
 * the emitter needs are pre-computed here so the emit phase stays
 * mechanical.
 */
export interface ParsedOperation {
  /** Dotted SDK name — e.g. 'knowledge.search'. */
  sdkName: string
  /** OpenAPI path template — e.g. '/workspaces/{workspaceId}/knowledge/search'. */
  path: string
  method: HttpMethod
  /** True if `requestBody.content['application/json']` is present. */
  hasBody: boolean
  /** True if any parameter has `in: 'query'`. */
  hasQuery: boolean
  /** True if at least one query param has `required: true`. */
  hasRequiredQuery: boolean
  /** True if the operation returns a body (any 2xx that is not a 204/205
   *  No/Reset-Content). See `parse.ts` for why this is status-based, not
   *  content-based, in Vynel. */
  hasSuccessBody: boolean
}

/**
 * Namespace tree node. Each child is either an internal namespace
 * (children populated, operation null) or a leaf method (operation
 * non-null, children empty).
 */
export interface NamespaceNode {
  children: Map<string, NamespaceNode>
  operation: ParsedOperation | null
}

export function makeNode(): NamespaceNode {
  return { children: new Map(), operation: null }
}
