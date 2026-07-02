// Parse the OpenAPI spec into a flat list of ParsedOperation. Runs
// every validation that should fail loud at codegen time:
//   - x-sdk-name is REQUIRED on every operation (the type-level field is
//     optional only so the annotation sweep can land in stages; the
//     generator enforces required-in-practice).
//   - Each dotted segment must be a valid identifier.
//   - No two operations may share an x-sdk-name.
//
// Returns a stable-sorted list (by sdkName) so generator output is
// deterministic.

import {
  HTTP_METHODS,
  type OpenApiOperation,
  type OpenApiSpec,
  type ParsedOperation,
} from './types.js'

// Top-level namespaces become keys on the openapi-fetch client via
// `Object.assign` in `createVynelClient`. `use` + `eject` are the client's
// own methods; the HTTP-verb keys (GET/…) can't collide because the segment
// regex requires a lowercase first letter.
const RESERVED_NAMESPACES = new Set(['use', 'eject'])

export function parseSpec(spec: OpenApiSpec): ParsedOperation[] {
  const operations: ParsedOperation[] = []
  const seenNames = new Map<string, string>()

  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = methods[method]
      if (!op) continue

      const sdkName = op['x-sdk-name']
      if (!sdkName) {
        throw new Error(
          `[sdk:generate-namespaced] missing x-sdk-name annotation: ${method.toUpperCase()} ${routePath}\n` +
            `Add \`'x-sdk-name': 'namespace.method'\` to the route's describeRoute({ ... }).`,
        )
      }
      validateSdkName(sdkName, `${method.toUpperCase()} ${routePath}`)

      const prior = seenNames.get(sdkName)
      if (prior) {
        throw new Error(
          `[sdk:generate-namespaced] duplicate x-sdk-name: ${sdkName}\n` +
            `  first:  ${prior}\n` +
            `  second: ${method.toUpperCase()} ${routePath}`,
        )
      }
      seenNames.set(sdkName, `${method.toUpperCase()} ${routePath}`)

      operations.push({
        sdkName,
        path: routePath,
        method,
        hasBody: Boolean(op.requestBody?.content?.['application/json']),
        hasQuery: Boolean(op.parameters?.some((p) => p.in === 'query')),
        hasRequiredQuery: Boolean(
          op.parameters?.some((p) => p.in === 'query' && p.required === true),
        ),
        hasSuccessBody: hasSuccessBody(op),
      })
    }
  }

  return operations.sort((a, b) => a.sdkName.localeCompare(b.sdkName))
}

function validateSdkName(name: string, source: string): void {
  const segments = name.split('.')
  if (segments.length < 2) {
    throw new Error(
      `[sdk:generate-namespaced] x-sdk-name must be dotted (namespace.method): ` +
        `"${name}" on ${source}`,
    )
  }
  for (const segment of segments) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(segment)) {
      throw new Error(
        `[sdk:generate-namespaced] invalid x-sdk-name segment "${segment}" ` +
          `(must start with lowercase letter, contain only letters/digits): "${name}" on ${source}`,
      )
    }
  }
  const [top] = segments
  if (top && RESERVED_NAMESPACES.has(top)) {
    throw new Error(
      `[sdk:generate-namespaced] x-sdk-name namespace "${top}" collides with an ` +
        `openapi-fetch client key (Object.assign would clobber it): "${name}" on ${source}`,
    )
  }
}

// Whether the operation returns a response body (→ the method returns
// `data`) vs. no content (→ returns void). Status-based, NOT content-
// based: Vynel routes currently declare responses as prose without a
// `content` schema, so a content check would misclassify every route as
// bodyless. Any 2xx that is not a 204/205 (No/Reset-Content) is treated
// as body-bearing — openapi-fetch parses the actual body at runtime from
// the response Content-Type regardless of the declared schema. When
// routes gain response schemas the return TYPES tighten with no change
// here.
function hasSuccessBody(op: OpenApiOperation): boolean {
  if (!op.responses) return false
  for (const code of Object.keys(op.responses)) {
    if (!/^2\d\d$/.test(code)) continue
    if (code === '204' || code === '205') continue
    return true
  }
  return false
}
