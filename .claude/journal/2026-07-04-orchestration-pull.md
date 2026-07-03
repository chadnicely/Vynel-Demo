# 2026-07-04 — orchestration vertical-slice (the 2nd substrate beneath @vynel/session)

Second bottom-up pull after `chat` (`1568e91`). Orchestration = the **delegation engine**, "the VERB
over the `agents` noun": resolve `@mention`s, compose enabled agents into a session, run the
leaf/workspace-root delegation turn, record the tree edges + agent-run lifecycle, surface reports up.
It is a **composition tier above `chat` + `agents`** — not a leaf — and itself substrate for
`@vynel/session`.

**The Gate-1 map had one real wrinkle the close read surfaced.** Orchestration has two cross-feature
edges: `agents` (its *designed* dep) and `chat` (via the single file `resolve-delegation-trace`, which
went broken the moment chat's repos moved to `@vynel/chat`). Decision (mirrors `start-chat-turn`→session):
**EXCLUDE `resolve-delegation-trace`** — it's a cross-domain composed VIEW (the Ch3 trace panel), not core
delegation logic, so it relocates to the session/monitor tier. That drops ALL chat coupling; orchestration's
only cross-dep becomes `agents`, which is by-design (index.ts says so). Nothing internal imported the
trace-read (terminal read-op) → dropped its 4 barrel exports, left a comment recording where it lands.

**The fold wrinkle (caught before moving files).** The module note proposed `runners/` vs `agents/`, but
the internal import graph shows the delegation-runtime cluster is tightly coupled with `drain-leaf-turn`
as its **hub** — `create-leaf-session`, `push-to-session`, `run-root-delegation-turn`, and
`map-agent-to-leaf-input` all import it. Any fold that separates drain from its users manufactures 3+
peer-folder edges. The **only zero-peer-edge grouping** is all five together → `leaf/`. Rest by concern:
`agents/` (compose + resolve-mentions), `records/`, `queries/`, `routing/`; types+events+index at root.
`drainLeafTurn` + `mapAgentToLeafInput` stay OUT of the barrel (internal helpers). Name `leaf/` is
provisional — `run-root-delegation-turn` sits slightly oddly under it, but coupling justifies co-location.

**Sharpened order (advisor):** did the schema move FIRST and proved `drizzle-kit generate` → "No schema
changes" **in isolation** before pulling any logic — so the neutrality signal is unambiguous. Then pulled
+ folded the logic, then the full gate. Also confirmed the `@vynel/db` root barrel never re-exported schema
(+ zero external `delegationJobs` consumers) before dropping the schema-barrel line — a 30-second catch the
subpath grep couldn't see.

**One real find at typecheck:** `compose-session-agents` imports `import type { AgentDefinition }` from the
SDK (type-only, erased; flows through the public `composeSessionAgents` return `Record<string,
AgentDefinition>`). Not a runtime import, so not an AI-seam violation — and `@vynel/agents` (a reviewed leaf)
sets the precedent. Landed faithfully as a real dep. **Possible improve:** re-export `AgentDefinition` via
`@vynel/agents` to keep orchestration SDK-free — flagged for review, not a blocker.

**Mechanics:** git-mv schema+repos from kernel (history preserved, hub FKs → `@vynel/db/schema/{users,
workspaces}`); logic pulled fresh from old `packages/core/src/orchestration/` (READ-ONLY `754615f`). Rewired
`@vynel/core/agents` → `@vynel/agents`; orchestration repo `@vynel/db/repositories/orchestration` → local
`../repositories/index.js`; fold-induced cross-folder relatives `./X.js` → `../X.js` (scoped per folder, never
tree-wide — index.ts's root-sibling `./orchestration-events.js` must stay `./`). `_shared` + `agents` repo
imports stay kernel.

**Green + neutral:** turbo typecheck 43/43 · schema-parity **30** · mcp/sdk parity ok · vitest **1133 pass /
4 skip** (1091 → 1133, +42 orchestration tests across 14 files). No flaky-vitest startup race this time (the
fold distributes test files off the src root; cache stayed warm).

**Next:** the substrate is now in (chat + orchestration) → build the **`@vynel/session` keystone** (houses
continuity + all runners + composers + sinks + the excluded `start-chat-turn` / `resolve-delegation-trace`;
the ③ MCP binding + real approval card ride on it). **`approvals` completion rides WITH that push** (Chad's
pairing): fold it into concern-folders AND decouple the `chat → approvals` lazy-import seam — the decouple's
injection point (the workspace turn-runner `start-chat-turn`) only exists once session's runners land, so it
can't happen before session.
