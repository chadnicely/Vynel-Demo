# packages/ — internal libraries

Everything that gets **imported**. No process lifecycle. Never imports from `apps/`.
Fills in module-by-module as we move code (see `../docs/architecture.md` §10). Intended layout:

- **kernel:** `db` (schema · repositories · dialect · client · migrate · outbox) — the shared spine.
- **shared:** `errors` · `logger` · `contracts` · `config`.
- **AI seam:** `providers` (`AiAgentProvider` + Claude impl — the only place `claude-agent-sdk` is imported).
- **stateless helpers:** `embeddings` · `indexer` · `desktop-control`.
- **MCP:** `mcp-contract` (the `McpFeatureDescriptor`) · `sdk` (generated typed client).
- **composition:** `session` (the parametric Session primitive).
- **leaves (`@vynel/<feature>`):** `knowledge` · `memory` · `files` · `capabilities` · `marketplace`
  · `agents` · `approvals` · `channels` · `skills` · `schedules` · `voice`.
- **spine + shim:** `core` (spine ops + re-export shim during the move).
- **P2 stubs (interfaces now):** `pubsub` · `queue` · `feature-flags`. **Test util:** `testing`.

**Reuse contract:** a leaf owns its tables/repos/ops (+ optional MCP descriptor, routes, jobs),
depends only on the kernel + shared, links to other features only via loose-ref + outbox, and exposes
one clean `index.ts`. See `../docs/architecture.md` §3.
