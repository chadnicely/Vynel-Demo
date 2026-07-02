// Emit TypeScript source from the namespace tree. Method signatures
// derive their input/response types via indexed access on the `paths`
// interface — no schema duplication; the same source drives both
// shapes (path-keyed + namespaced).

import type { NamespaceNode, ParsedOperation } from './types.js'

export function emitMethod(name: string, op: ParsedOperation): string {
  // Parameter list (in order):
  //   - path params:         one positional `<paramName>: string` per
  //                          `{name}` segment, in path order. A route with
  //                          a single `{workspaceId}` emits
  //                          `(workspaceId: string)`; multiple params (e.g.
  //                          `/workspaces/{workspaceId}/knowledge/documents/{documentId}`)
  //                          emit one positional each: `(workspaceId, documentId)`.
  //   - hasBody:             positional `input: <BodyType>`
  //   - hasQuery (optional): optional `options?: <QueryType>`
  //   - hasQuery (required): required `options: <QueryType>` (no `?`)
  // All combinations are handled, including path-param + query.

  const params: string[] = []
  // `params: { path, query }` is ONE openapi-fetch key — path-param and
  // query sub-objects must merge into a single `params` entry (two separate
  // `params:` keys in the same object literal would silently overwrite). We
  // collect the sub-entries here and assemble one `params: {...}` below.
  const paramsSubEntries: string[] = []
  const callOpts: string[] = []

  // Extract every `{name}` segment in path order. Each becomes a positional
  // string argument named after the segment; the call passes them through
  // `params.path` keyed by their real names. openapi-fetch fills the path
  // template from that object.
  const pathParamNames = (op.path.match(/\{([^}]+)\}/g) ?? []).map((seg) =>
    seg.slice(1, -1),
  )
  if (pathParamNames.length > 0) {
    for (const paramName of pathParamNames) {
      params.push(`${paramName}: string`)
    }
    const pathEntries = pathParamNames.map((n) => `${n}: ${n}`).join(', ')
    paramsSubEntries.push(`path: { ${pathEntries} }`)
  }

  const pathLit = JSON.stringify(op.path)
  const methodLit = JSON.stringify(op.method.toUpperCase())

  if (op.hasBody) {
    // `NonNullable<...>` strips the `| undefined` openapi-typescript puts on
    // `requestBody` — without it, indexing `['content']` on a possibly-undefined
    // requestBody is a TS2339 (first hit: the add-to-knowledge POST body).
    params.push(
      `input: NonNullable<paths[${pathLit}][${JSON.stringify(op.method)}]['requestBody']>['content']['application/json']`,
    )
    callOpts.push(`body: input`)
  }

  if (op.hasQuery) {
    // If any query param is required, `options` itself must be required
    // (TypeScript otherwise rejects `undefined` as the query value when
    // the type expects a required field).
    const optionalMarker = op.hasRequiredQuery ? '' : '?'
    params.push(
      `options${optionalMarker}: NonNullable<paths[${pathLit}][${JSON.stringify(op.method)}]['parameters']>['query']`,
    )
    // Under `exactOptionalPropertyTypes`, an optional `options` cannot be
    // passed as `query: undefined` (the key must be omitted when absent) —
    // spread it conditionally. A required query passes straight through.
    paramsSubEntries.push(
      op.hasRequiredQuery ? `query: options` : `...(options && { query: options })`,
    )
  }

  // Merge path + query into the single `params` key (order: path, query).
  if (paramsSubEntries.length > 0) {
    callOpts.unshift(`params: { ${paramsSubEntries.join(', ')} }`)
  }

  const paramList = params.join(', ')
  const callOptsStr =
    callOpts.length > 0
      ? `, {\n      ${callOpts.join(',\n      ')},\n    }`
      : ''

  const bodyDestructure = op.hasSuccessBody
    ? `const { data, error, response } = await client[${methodLit}](${pathLit}${callOptsStr})`
    : `const { error, response } = await client[${methodLit}](${pathLit}${callOptsStr})`

  // `data === undefined` (not `!data`): openapi-fetch yields `data:
  // undefined` on a transport error or a genuinely empty 2xx, but a
  // legitimately falsy JSON body (`0`, `false`, `""`, `null`) is a valid
  // success and must NOT throw.
  const throwLine = op.hasSuccessBody
    ? `if (error || data === undefined) throw new SdkError(response, error ?? data)`
    : `if (error) throw new SdkError(response, error)`

  const returnLine = op.hasSuccessBody ? '    return data' : ''

  return `  ${name}: async (${paramList}) => {
    ${bodyDestructure}
    ${throwLine}
${returnLine}
  },`
}

export function emitNode(node: NamespaceNode, depth: number): string {
  const indent = '  '.repeat(depth)
  const innerIndent = '  '.repeat(depth + 1)
  const entries: string[] = []

  // Sort children alphabetically for deterministic output.
  const sortedChildren = [...node.children.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )

  for (const [name, child] of sortedChildren) {
    if (child.operation) {
      // Leaf — emit the method.
      entries.push(emitMethod(name, child.operation))
    } else {
      // Internal namespace — recurse.
      const inner = emitNode(child, depth + 1)
      entries.push(`${innerIndent}${name}: ${inner},`)
    }
  }

  return `{\n${entries.join('\n')}\n${indent}}`
}
