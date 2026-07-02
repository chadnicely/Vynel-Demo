# 2026-07-02 — response schemas → typed SDK returns (B)

The B side of the B/C fork (Chad: "complete both, start from B"). Step C shipped the namespaced SDK
with **loosely-typed returns** because the knowledge routes declared prose responses (no `content`
schema) → the generated `paths` typed every response body as `never`/`undefined`. B closes that root
cause: declare response schemas so `client.knowledge.search()` returns
`{ results: SerializedKnowledgeSearchResult[] }` — and it fixes the **flat** SDK (`client.GET(...)`) too.

**Built:**
- `apps/local-api/src/routes/knowledge/schemas.ts` — response schemas (`KnowledgeDocumentSchema`,
  `KnowledgeChunkSchema`, `KnowledgeSearchResultSchema`, `IndexerStatusSchema`) + the 4 envelopes
  (`ListKnowledgeDocumentsResponseSchema` with `nextCursor: {indexedAt,id}|null`,
  `KnowledgeDocumentDetailResponseSchema`, `SearchKnowledgeResponseSchema`, `ReindexResponseSchema`),
  reusing the existing `DocumentKindSchema` / `ParseStatusSchema` enums.
- `apps/local-api/src/routes/knowledge/serializers.ts` — the `Serialized*` output types are now
  `z.infer<typeof XSchema>` — **one source of truth** (the Zod schema). Adding a required field forces
  the serializer to satisfy it or fail typecheck. Net −50 lines of hand-authored types.
- `apps/local-api/src/routes/knowledge/index.ts` — `resolver(Schema)` (from `hono-openapi/zod@0.4.8`) wired
  into each route's **200** response `content`. Errors (404) stay prose — the namespaced methods throw
  `SdkError` (`body: unknown`), so a typed error body adds little.
- Regenerated `openapi.json` + `api.d.ts` (response types now real). `namespaced.ts` **source** is
  unchanged (it references `paths` by indexed access — only the resolved types tightened).
- Type-level regression guards in `namespaced.test.ts` (`expectTypeOf`, checked by `turbo typecheck`),
  one per knowledge route.

**Gate:** `turbo typecheck` · `pnpm test:parity` (schema 29 · mcp · sdk) · `vitest` **497 passed /
4 skipped** (+3 = the type guards). `pnpm api:generate` unchanged counts (5 paths / 5 methods / 4 tools).

**Code review (Gate 3): PASS, zero must-fix, 1 should-fix (addressed).** The reviewer traced all 5
routes against the generated `api.d.ts` (ground truth) and confirmed exact schema↔runtime fidelity —
no enum widening (`DocumentKind`/`ParseStatus` match), no nullable-vs-optional drift, `resolver` is
OpenAPI-doc-only (runtime bytes unchanged), no external `Serialized*` consumer broken. Addressed the
should-fix: the `expectTypeOf` block guarded only 2 of 5 routes → added `listDocuments` / `getDocument`
/ `reindex` so all five are type-guarded. (Parity already catches response-schema drift on any route;
the guards are the in-IDE canary.)

**Next:** **D** — `apps/cli` (net-new; no KAFI/letterman reference) over the namespaced SDK
(`vynel knowledge <search|list|get|status|reindex> --workspace <id>`) via `commander`, direction ①.
