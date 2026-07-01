# Knowledge — module notes (gaps to fix on pull)

The source of truth for what changes vs the old implementation when we pull `@vynel/knowledge`.
Chad advises per module; this captures his advice + the known old-repo gaps. **Land faithfully and
green first, then improve to close these.**

## Chad's advice (2026-07-02)

**Knowledge must be addable at WORKSPACE scope OR GLOBAL scope, by the user ADDING DIRECTORIES.**

- **Old repo:** per-workspace only — the workspace's own folder is auto-watched/indexed.
- **New:** the user always gets the option to choose a **scope** and **add one or more directories**
  to index:
  - **workspace** — knowledge for that workspace.
  - **global (user-level)** — a personal knowledge base available across *all* the user's workspaces.

**Knowledge lives on MCP — including *adding*.** The user will say *"add this to my knowledge base,"*
so the assistant must do it via an MCP tool — not only a UI button. Expose an **add-to-knowledge**
tool (register a directory / add content, at a chosen scope) alongside the existing read tools
(`search_knowledge`, `list_knowledge_documents`, …). It is **mutating → cards for approval**.
*(Old repo exposed only read knowledge tools; the write/reindex path was never MCP-exposed — this
closes that gap.)*

## Design implications (plan deliberately — it's a schema change)

- Add a **scope** to knowledge (`global` | `workspace`), mirroring `agents`/`capabilities`
  (nullable `workspaceId` ⇒ global; `userId` always present).
- Add a **knowledge-source/directory registry** (user-registered directories to index: `path` +
  `scope`), replacing "auto-index the workspace folder only." The file-watcher watches the registered
  directories. Path-safety + skip rules (`.vynel/`, `Archive/`, > 50 MB, unsupported) still apply.
- `documents` / `chunks` carry scope. Search at a workspace resolves to **that workspace's knowledge
  + the user's global knowledge.**
- Routes / MCP: expose add-directory + scope selection; keep the `McpFeatureDescriptor` + capability
  gating.

## Sequencing

Pull knowledge faithfully (per-workspace) → `pnpm test` green → **then** implement the scope +
add-directories enhancement as a deliberate improvement. Chad will point on specifics at pull time.
