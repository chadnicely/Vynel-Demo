# 2026-07-02 — namespaced SDK (Step C)

Adopt the reference repo (letterman)'s **namespaced-SDK facade** into `@vynel/sdk`:
`client.knowledge.search(workspaceId, { query })` on top of the flat openapi-fetch client, both
surfaces on one instance. Net-new (not a KAFI pull — KAFI's `describeRoute` wrapper only widened
`x-mcp`).

**The pipeline** — a second generator pass over the emitted `openapi.json` (does NOT re-derive from
routes, does NOT touch the flat types):
```
route x-sdk-name → openapi.json → generate-namespaced-sdk → namespaced.ts (makeNamespaced factory)
                                    (parse → tree → emit; types by indexed access on `paths`)
```

**Built:**
- `apps/local-api/src/openapi.ts` — `describeRoute` wrapper widened with `'x-sdk-name'?: string` (type-optional,
  generator-required).
- The 5 knowledge routes annotated: `knowledge.{listDocuments,getDocument,search,getStatus,reindex}`.
  `reindex` gets an SDK name despite no `x-mcp` — the SDK is the full typed surface; MCP ⊆ SDK.
- `scripts/src/generators/namespaced-sdk/{types,parse,tree,emit}.ts` + `generate-namespaced-sdk.ts` —
  copied ~verbatim from letterman (pure OpenAPI-JSON → string emitters), chained into `api:generate`.
- `packages/sdk/src/errors.ts` — `SdkError` (status/body/response), message lifted from Vynel's
  `{ code, message }` envelope.
- `packages/sdk/src/index.ts` — `createVynelClient` composes `Object.assign(client, makeNamespaced(client))`;
  `VynelClient = Client<paths> & ReturnType<typeof makeNamespaced>`; re-exports `SdkError`.
- `check-sdk-parity.ts` — runs both SDK generators in order + guards `namespaced.ts` alongside the flat
  artifacts. Golden + runtime tests in `namespaced.test.ts`.

**Gate:** `turbo typecheck` · `pnpm test:parity` (schema 29 · mcp · sdk incl. `namespaced.ts`) ·
`vitest` **489 passed / 4 skipped** (+2 = the namespaced golden + runtime tests). `pnpm api:generate`
→ 5 paths / **5 namespaced methods** / 4 MCP tools.

**Two deliberate Vynel adaptations of letterman's generator:**
- `hasSuccessBody` is **status-based** (`2xx && not 204/205`), not content-based. Vynel's knowledge
  routes declare prose responses (no `content` schema), so letterman's content check would misclassify
  every route as bodyless → methods would emit as `void`. openapi-fetch parses the real body at runtime
  regardless; return TYPES tighten for free once response schemas land.
- `emit.ts` spreads optional query as `...(options && { query: options })`, not `query: options` —
  Vynel's tsconfig has `exactOptionalPropertyTypes: true` (letterman's doesn't), which rejects passing
  `query: undefined`. Required query passes straight through.

**The B/C fork (owner's call — proceeded with C while away, B queued):** the routes declare no response
schemas, so the generated `paths` types every response body as `never`/`undefined` — `client.knowledge.
search()` returns runtime-correct data typed as `undefined`. This affects the flat SDK too (pre-existing
since Step B). Asked Chad **B** (declare ~5 Zod response schemas → genuinely-typed returns; fixes the
flat SDK too; letterman's `hasSuccessBody` would then work unchanged) vs **C** (ship the pattern now,
loosely-typed). He was away 60s; shipped **C** as the reversible choice (B layers on additively — the
generator keeps working, returns just tighten). **B is the recommended next step, pending Chad's okay.**

**Code review (Gate 3) — `code-reviewer` on the staged diff: PASS, zero must-fix + 6 should-fix.**
It traced all 5 methods as runtime-correct and confirmed both adaptations, the `Object.assign`
soundness, and `SdkError`. Applied this move:
- *SF-1* — added request-shaping tests (a capturing client): the optional-query spread was untested
  (my riskiest adaptation). Now asserts optional query omitted when absent / present when passed /
  required passed through. (492 passed, +3.)
- *SF-2* — emit `if (error || data === undefined)` instead of `!data`: a legitimately falsy body
  (`0`/`false`/`""`/`null`) or a 200+204 route must not throw on success. Latent (the current 5 return
  objects) but the generator is reusable.
- *SF-3* — added `.prettierignore` (generated dirs + `openapi.json`): `pnpm format` would otherwise
  reflow generated files and break the parity guards. ESLint already ignored them; prettier didn't.
- *SF-4* — `parse.ts` rejects reserved top-level namespaces (`use`/`eject`) that `Object.assign` would
  clobber on the openapi-fetch client (the HTTP-verb keys can't collide — the segment regex requires a
  lowercase first letter).
- *SF-5* — dropped the dead `hasPathParam` field (emit derives path params from the path regex).

Deferred: *SF-6* — extract `buildParamList` from the ~85-line `emitMethod` (cohesive, ~verbatim from
letterman; improve-pass, not faithfulness).

**Next:** **B** — response-schema discipline (declare route response content → typed SDK returns), if
Chad approves; it's really an API-completeness pattern every feature inherits. Then **D** — `apps/cli`
over the namespaced SDK (direction ①).
