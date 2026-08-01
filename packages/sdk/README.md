# @vynel/sdk

TypeScript types + runtime client for the Vynel v1 API.

## Two artifacts

- **`src/generated/api.d.ts`** — typed paths / components / operations,
  generated from the live API's OpenAPI 3.1 spec.
- **`openapi.json`** — the OpenAPI document snapshot.

Both are committed to git per `.claude/rules/sdk-mcp.md` "Discipline"
so a fresh checkout typechecks without running the generator first.

## Regenerate

```sh
pnpm api:generate
```

Runs `scripts/src/generators/generate-sdk.ts` which:
1. Spins up an in-memory `createApp(...)` from `@vynel/local-api/app`.
2. Dispatches `app.request('/openapi.json')` (the `app-request-spec-trick`
   letterman locked — `generateSpecs(app)` does NOT flatten routes
   mounted via `.route(...)`).
3. Writes the snapshot to `openapi.json` and the types to
   `src/generated/api.d.ts`.

Mandatory after any route, schema, or `describeRoute(...)` change.

## Runtime client

`createVynelClient({ baseUrl })` returns a typed
[`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) client keyed
against the generated `paths`:

```ts
import { createVynelClient } from '@vynel/sdk'

const vynelApi = createVynelClient({ baseUrl: '' })

const { data, error } = await vynelApi.GET('/workspaces', {
  params: { query: { includeArchived: false } },
})
```

In `apps/web` dev, `baseUrl: ''` works because Vite proxies the API
path prefixes to `http://localhost:18892`. Phase 1 has no auth — the
bearer-token + 401-interceptor middleware lands alongside the Phase 2
`auth` domain.

## Canonical references

- `.claude/memory/decisions/apps-web-foundation-design.md` — the
  locked architecture (single chain
  `@vynel/contracts` → API → openapi.json → SDK types → fetcher).
- `.claude/rules/sdk-mcp.md` — the SDK + MCP pipeline rule, including
  the `pnpm api:generate` discipline.
- `scripts/src/generators/generate-sdk.ts` — the generator.
