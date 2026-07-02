// Generate the namespaced SDK facade from openapi.json's `x-sdk-name`
// annotations.
//
// Flow: read packages/sdk/openapi.json → parse + validate annotations →
// build the namespace tree → emit a typed TS file at
// packages/sdk/src/generated/namespaced.ts that exports
// `makeNamespaced(client)`. The factory returns the
// `client.knowledge.search()` shape, composed onto the same
// openapi-fetch Client inside `createVynelClient`.
//
// Implementation is split across ./namespaced-sdk/:
//   - types.ts — OpenAPI shape + internal ParsedOperation / tree model
//   - parse.ts — read spec → validate → flat ParsedOperation list
//   - tree.ts  — flat list → nested NamespaceNode tree
//   - emit.ts  — tree → TS source
// This file is the orchestrator; each sibling stays under the ~300-line
// file cap.
//
// Runs as the second SDK pass in `pnpm api:generate` (after generate-sdk,
// which emits the openapi.json this reads). Drift is caught by
// `check-sdk-parity.ts`.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { emitNode } from './namespaced-sdk/emit.js'
import { parseSpec } from './namespaced-sdk/parse.js'
import { buildTree } from './namespaced-sdk/tree.js'
import type { OpenApiSpec } from './namespaced-sdk/types.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const sdkOpenApiPath = path.join(repoRoot, 'packages', 'sdk', 'openapi.json')
const sdkNamespacedPath = path.join(
  repoRoot,
  'packages',
  'sdk',
  'src',
  'generated',
  'namespaced.ts',
)

const spec = JSON.parse(readFileSync(sdkOpenApiPath, 'utf8')) as OpenApiSpec

const operations = parseSpec(spec)
const tree = buildTree(operations)
const body = emitNode(tree, 0)

const header = `// GENERATED — DO NOT EDIT
//
// Auto-emitted by \`scripts/src/generators/generate-namespaced-sdk.ts\`
// from \`packages/sdk/openapi.json\`'s \`x-sdk-name\` annotations.
// Regenerate via \`pnpm api:generate\`. Drift is caught by
// \`scripts/src/generators/check-sdk-parity.ts\`. NEVER hand-edit.
//
// The namespaced SDK facade — the \`client.knowledge.search()\` shape on
// top of the openapi-fetch runtime, composed into \`createVynelClient\`
// via \`Object.assign\` so the path-keyed surface (\`client.GET(...)\`) and
// the namespaced surface coexist on one instance, sharing config.
//
// Method signatures derive their types via indexed access on the flat
// \`paths\` type — zero duplication. Methods throw \`SdkError\` on non-2xx;
// the path-keyed surface keeps returning \`{ data, error }\`.

import type { Client } from 'openapi-fetch'
import { SdkError } from '../errors.js'
import type { paths } from './api.js'

export function makeNamespaced(client: Client<paths>) {
  return ${body}
}
`

writeFileSync(sdkNamespacedPath, header)

// eslint-disable-next-line no-console
console.log(
  `[sdk:generate-namespaced] wrote ${path.relative(repoRoot, sdkNamespacedPath)} — ${operations.length} method(s)`,
)
