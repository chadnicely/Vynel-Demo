# Tool policy — module notes

Arc: **Internal MCP tools with mode and consumer kind** (2026-08-14, branch
`feature/mcp-tool-policy`). Six slices, each gated + reviewed + committed separately.

## The problem (what Chad reported)

1. **The `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` boot warning was a real gating hole, not noise.**
   The composer minted a bare `mcp__<server>__*` wildcard per descriptor into `allowedTools`,
   so the SDK auto-approved every MCP tool *before* `canUseTool`. In Ask mode the only MCP
   carding alive was the PreToolUse hook's curated tier (8 generated names +
   `propose_desktop_plan`).
2. **Tier (basic/pro) denied instead of filtering.** Entitlement was read only in the HTTP
   `featureGate` middleware — out-of-tier tools were still advertised to the model and 403'd at
   call time; descriptors calling package ops directly (ssh, notebook, ask, desktop, study)
   never met the tier gate at all.
3. **"Which tool is allowed where" was illegible.** Surface → descriptor lists hardcoded in 9
   places, no admin view, and no UI at all for the existing capability toggles.
4. **No way for Claude to ask the user outside interactive turns.**

## Decisions (Chad, 2026-08-14)

1. **Ask-mode default stays behavior-neutral:** only today's curated 9 card in Ask mode;
   reads + builtins (memory/journal/tasks/plans…) resolve-allow from the map. Promotion and
   demotion happen in the admin view, not in code defaults.
2. **The admin matrix is FULLY editable** — per tool: enabled, card class
   (never / ask / always), surfaces, tier requirement, capability binding.
3. **The capability toggles UI folds into the same admin section** (first capabilities UI
   ever).

Standing stances honored throughout: interactive asks never time out (ask.md fork #1);
a spawned session keeps its parent's whole toolset (Chad 2026-07-26 — pinned by a
catalog drift test); auto/bypass mean "don't ask permission", never "never check a
preference" (the ask prompt says so explicitly now).

## The design — one policy map, every consumer reads it

**`EffectiveToolPolicy`** per tool = declared catalog defaults ⊕ admin overrides.

- **Overrides:** `tool_policies` (leaf-owned in `packages/capabilities`, migration 0039).
  Every column nullable = inherit; `featureKey`/`capabilityId` accept `'none'` = ungate; an
  all-null save normalizes to a delete (the DELETE route is exactly that). Every change
  co-commits a `TOOL_POLICY_UPDATED` outbox event.
- **Catalog:** `apps/local-api/src/sessions/session-tool-catalog.ts` — the
  `SURFACE_DESCRIPTOR_SETS` read model (9 `SessionSurfaceKind`s → server lists) +
  `buildSessionToolCatalog()` assembling per-tool defaults from the generated gate arrays
  (`@vynel/mcp/tool-gates`) and the small fixed servers' declared inventories.
  Duplicate-name surface membership is pre-merged (several vynel tools ride two arrays).
- **Three enforcement layers, one source:**
  1. *Composition = filtering (what the model SEES).* Admin-disabled, out-of-surface,
     out-of-tier (`featureGatedTools`, the tier twin of `capabilityGatedTools`), and
     capability-off all land in `deniedMcpToolPatterns` → SDK `disallowedTools`. Out-of-tier
     tools are now invisible, not 403s. Entitlement fail-open on null (deliberate Phase-1
     posture); the HTTP `featureGate` stays as defense in depth.
  2. *Permission = the map inside `canUseTool` (what the model may DO).* No MCP wildcards in
     `allowedTools` anymore — every MCP call reaches the callback.
     `packages/providers/src/claude/approvals/tool-approval-policy.ts` is the ONE decision
     home both the callback and the PreToolUse hook consult. The ask-mode map-allow is scoped
     to composed server names, so an external settings-loaded server's tools keep carding.
  3. *Runtime = the existing card flow, unchanged* (PendingApprovalRegistry, web/Telegram
     decide, reaper, remember-rules).
- **Modes:** `bypass-with-behavior-gate` now runs under SDK `'default'` (the hook forces the
  card path; SDK `bypassPermissions` never consults `canUseTool`). Pure `bypass` binds **no**
  `canUseTool` at all. The distill turn moved to pure `bypass` (toolless, never prompts).
- **Card classes:** `never` → resolve-allow; `ask` → card in ask/plan-only; `always` → card in
  every carding mode. The composer applies overrides authoritatively — strip then re-add — so
  a demote out of the curated tier really demotes.
- **Admin surface:** `GET/PUT/DELETE /tool-policies` (user-scoped, **x-mcp OFF** — an agent
  must never edit its own gates; guarded by an OpenAPI test) + `ToolPolicySection.vue`
  (grouped-by-server editable matrix) + `CapabilityTogglesPanel` in the same section.
- **The regeneration point:** route `x-mcp` annotations → `generate-mcp-tools.ts` → generated
  arrays → `apps/mcp/src/vynel-tool-gates.ts` (exported via the `@vynel/mcp/tool-gates`
  subpath) → catalog → policies. CLI and internal SDK servers stay in lockstep; the external
  `vynel-mcp` bin filters admin-disabled tools through one `GET /tool-policies` read at
  startup (3s timeout, fail-open with a stderr line).
- **Voluntary ask:** channel turns attach `vynel-ask` with a bounded `timeoutMs` (10 min —
  the approvals-reaper bound); expiry resolves `{answered:false, reason:'expired'}` with the
  row-expire guarded (a timer callback has no upstream catch — an unguarded throw is a
  process crash). Interactive streams keep the unbounded wait. Boot shares one
  `PendingAskRegistry` across the app and the channels service. `ask_requests.sessionId` is
  now stamped from the compose context (loose ref, no FK).

## As-built lessons

- **The catalog is the policy source — attaching a server at a turn site without granting the
  surface in the catalog means the policy layer denies the very tool the turn composed.** The
  Slice-5 reviewer caught exactly this (vynel-ask on `global-channel`); the real-catalog
  compose test in `compose-session-mcp-servers.test.ts` now pins the class of bug.
- Bare (paren-less) `allowedTools` entries shadow `canUseTool` — the SDK auto-approves them.
  Native names still ride `allowedTools`; MCP names never do again.
- `cmd.exe /c "pnpm test" | tail` reports tail's exit code, not the gate's — always redirect
  to a file and check `$?`.

## Deferred (recorded, with owners' context)

- **SDK-free tool-gates:** the `@vynel/mcp/tool-gates` subpath still transitively pulls the
  SDK *builder* via the generated registry. Improve: teach `generate-mcp-tools.ts` to emit a
  names-only module (and `apiPathByToolName`, which would also let a test assert "every tool
  under a gated route prefix ∈ the tier map" — closing the structural drift gap).
- **Agent rows with configured `allowedTools`** forward bare native names
  (`map-agent-to-leaf-input.ts`, `delegate-to-agent-session.ts`) — the SHADOWED warning can
  still fire on those agent-session turns (behavior neutral; hook rescues the floor).
  Candidate: a `preApprovedToolNames` set in the policy map.
- **`workspace-background` surface kind is an orphan** — no turn site passes it today (the
  background builders adapt to schedule/spawned/delegated kinds). Remove or claim it.
- **Delegated + schedule turns stay ask-free** — attaching needs the turnKey lifecycle
  threaded through the session leaf's core runner.
- **Telegram in-channel ask ANSWERING** (nudge only today; answering stays in-app).
- **Inventory pins** for notebook/ask/study descriptor `toolNames` (desktop + ssh have them).
- Small nits: no-op outbox event when resetting an absent override row; mutating-set dedupe
  via Sets in the composer; PUT route double-resolves effective policies; an
  `overriddenFields` wire field would let the edit dialog seed exactly; `run-global-root-turn.ts`
  is ~460 lines — extract on next touch.
- `.claude/docs/_apps/mcp/structure.md` + `.claude/docs/capabilities/structure.md` carry drift
  banners pointing here — full remap on next module touch.

## End-of-arc live smokes (band 18910; ask Chad for the rest)

1. `pnpm dev api` boots with **no SHADOWED warning**; an Ask-mode turn cards `delete_agent`
   but not `list_tasks`.
2. A `bypass-with-behavior-gate` turn still cards the floor + mutating set (now under SDK
   `'default'`), including inside subagents.
3. An auto-mode turn's classifier sees composed MCP calls (no wildcard pre-approval).
4. Simulated basic tier: ssh/apps tools absent from the model's toolset, not erroring.
5. Admin section: flip a tool to Always → it cards in auto; disable a tool → gone next turn.
6. A channel turn calls `ask_user` → web notifier + Telegram nudge → unanswered 10 min →
   turn resumes with `expired`.
7. Chad to smoke: admin view UX, an end-to-end Telegram ask nudge, and a real pro/basic
   entitlement if a test account is available.
