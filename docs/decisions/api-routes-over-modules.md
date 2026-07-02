# Decision: API = thin routes over reusable packages (not fat modules)

**Accepted 2026-07-02 (Chad).** Stack: **Hono** (confirmed — not Express).

**The choice.** Two reference styles were compared:
- **Modules** (`E:\GROWTH HACKING REBUILD\letterman`, Express) — `apps/local-api/src/modules/<domain>/` co-locates
  `routes → controller → service → model + dto + schemas`; **feature logic lives *in* the api module**;
  SDK is hand-written; it *skipped* the OpenAPI/SDK/MCP pipeline. A pragmatic single-surface MVP port.
- **Routes** (`E:\GROWTH HACKING V2\letterman` + Vynel, Hono) — `apps/local-api/src/routes/<domain>/` is *thin*
  (`index`+`schemas`+`serializers`+`descriptors`); **logic lives in reusable `@vynel/<feature>` packages**;
  thin declarative routes (`x-mcp`/`x-sdk-name`) feed the **generated** OpenAPI → SDK → MCP pipeline.

**Decision: routes-over-packages on Hono.** The api is a thin transport surface; every feature's logic
lives in `@vynel/<feature>` so it's reusable by **api + cli + worker + mcp + agent-SDK** (one core, many
surfaces). Fat modules can't deliver that — `packages` can't import `apps` — and they can't feed the
generation pipeline (which is why REBUILD-letterman hand-wrote its SDK). This is also Vynel's existing,
tested shape.

**Borrowed from the modules approach:** its clean per-feature layering + co-location — achieved across
the split: the **package** is `service`+`model` (reusable); the **thin route folder** (`routes/<domain>/`)
is `routes`+`handlers`+`serializers`(dto)+`schemas`. (If we prefer the word, api folders may be named
`modules/<domain>/` but stay thin and call the package.)

**Follow-on:** adopt V2-letterman's **generated namespaced SDK** (`x-sdk-name`) as the base for the CLI +
the MCP directions. See `docs/architecture.md` §6.
