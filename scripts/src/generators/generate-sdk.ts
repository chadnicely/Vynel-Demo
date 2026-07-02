// Generate the @vynel/sdk types from the live API surface.
//
// Flow: construct a temp api app via createApp() (with stub deps —
// the spec route only walks route metadata, never hits the deps) →
// dispatch `app.request('/openapi.json')` to capture the spec the
// `openAPISpecs` middleware emits (the `app-request-spec-trick`
// letterman locked; a static `generateSpecs(app)` call does NOT
// flatten routes mounted via `.route(...)`, silently emitting empty
// `paths`) → write the OpenAPI document snapshot to
// `packages/sdk/openapi.json` → run `openapi-typescript` on it →
// emit typed paths/components/operations to
// `packages/sdk/src/generated/api.d.ts`.
//
// Run: `pnpm api:generate` (= `tsx scripts/src/generators/generate-sdk.ts`).
// The two output artifacts are checked into git so a fresh checkout
// typechecks without first running the generator. Re-run after any
// route, schema, or `describeRoute(...)` change. Per
// `.claude/rules/sdk-mcp.md` "Discipline" +
// `.claude/memory/decisions/apps-web-foundation-design.md`.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'
// Workspace-package import (NOT cross-package `..` traversal — see
// `.claude/rules/coding-standard.md` "Imports"). `@vynel/local-api` exposes
// `./app` via its package.json `exports` field for exactly this case
// (the SDK generator dispatching a synthetic request to the live API
// surface).
import { createApp, type CreateAppOptions } from '@vynel/local-api/app'

// scripts/src/generators/ -> repo root (three levels up).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const sdkOpenApiPath = path.join(repoRoot, 'packages', 'sdk', 'openapi.json')
const sdkGeneratedDir = path.join(repoRoot, 'packages', 'sdk', 'src', 'generated')
const sdkTypesPath = path.join(sdkGeneratedDir, 'api.d.ts')

// Stub deps — handlers never run here, only their metadata is walked,
// so the concrete `db` + `logger` are never touched. `as unknown as
// CreateAppOptions` is the documented escape hatch (`coding-standard.md`
// — loose casts forbidden without a justifying comment; this is the
// justification). Mirrors letterman's pattern.
const stubDeps = {} as unknown as CreateAppOptions

const app = createApp(stubDeps)
const specResponse = await app.request('/openapi.json')
if (!specResponse.ok) {
  const body = await specResponse.text()
  throw new Error(`[sdk:generate] /openapi.json returned ${specResponse.status}: ${body}`)
}

const spec = (await specResponse.json()) as Record<string, unknown>
const paths = (spec['paths'] ?? {}) as Record<string, unknown>
const pathCount = Object.keys(paths).length

mkdirSync(sdkGeneratedDir, { recursive: true })
writeFileSync(sdkOpenApiPath, JSON.stringify(spec, null, 2) + '\n')
// eslint-disable-next-line no-console
console.log(
  `[sdk:generate] wrote ${path.relative(repoRoot, sdkOpenApiPath)} ` +
    `(${pathCount} path${pathCount === 1 ? '' : 's'})`,
)

// Hard fail on empty paths — the failure mode `app-request-spec-trick`
// exists to prevent. The generator must NEVER silently emit a
// types-only SDK with empty `paths`. If this fires on Vynel's current
// `hono-openapi 0.4`, a coupled `hono` + `hono-openapi` + `zod-openapi`
// + `@hono/standard-validator` bump is the likely fix (per
// `dependencies.md` coupled-bump pairs).
if (pathCount === 0) {
  throw new Error(
    `[sdk:generate] OpenAPI spec has empty paths — the ` +
      `app-request-spec-trick failed. Inspect ` +
      `packages/sdk/openapi.json and verify hono-openapi's ` +
      `spec-walking works on this version.`,
  )
}

const ast = await openapiTS(JSON.stringify(spec))
const types = astToString(ast)
writeFileSync(sdkTypesPath, types)
// eslint-disable-next-line no-console
console.log(`[sdk:generate] wrote ${path.relative(repoRoot, sdkTypesPath)}`)
