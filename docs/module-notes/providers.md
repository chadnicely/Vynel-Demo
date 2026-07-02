# Provider pull — `@vynel/providers` (the AI seam) — SCOPE (filled 2026-07-03)

**Status: ✅ LANDED GREEN, foldered (2026-07-03).** Pulled `@vynel/providers` (67 files) and restructured the
old **flat `claude/internal/` (21 files)** into knowledge-style **concern folders** under `claude/`, keeping
the provider-agnostic shape (`shared/` contract → future `codex/` sibling). Full gate green: typecheck (17
pkgs) + parity (schema 30 · mcp 7 · sdk 7/8) + vitest **670 pass / 4 skip** (providers = 23 files / 142 tests).
package.json aligned to KLONE convention (`exports`).

### As-built structure
```
packages/providers/src/
  shared/     provider-agnostic CONTRACT (AiAgentProvider + normalized types + registries) — the codex shape
  registry.ts
  claude/     the Claude provider (primary; only priority now)
    claude-ai-agent-provider.ts
    base/          SDK adapter — claude-agent-sdk.ts is the SOLE non-test SDK import site + the raw-SDK-shape
                   fns (build-claude-sdk-options, translate-claude-sdk-event, claude-sdk-message-readers,
                   handle-attached-images). An Anthropic changelog change lands HERE.
    session/       driving query() (run-chat-session, run-context-report, run-session-summary, synthetic-event-queue)
    approvals/     permission wiring (can-use-tool callback, pre-tool/post-compact hooks, tools-always-requiring-approval)
    history/       persisted-session reads (fetch-transcript, synchronize, translate-persisted-message, session-storage)
    installation/  host install/config reads (auth-status, installed-skills, mcp-servers, executable-path, host-os-env-var)
```
Rewire was pure path-recompute: files moved at the **same depth** (`internal/` → `<concern>/`), so all
`../../shared`, bare, and same-concern imports were untouched — only 21 cross-concern edges + the 4 files
moving into `base/` changed. Tests colocated (ride with their subjects). Choke-point re-verified: `base/
claude-agent-sdk.ts` is the only non-test SDK importer.

**Two Chad corrections along the way (both honored):** ① rejected a staged "faithful-as-is copy → then fold"
as valueless ceremony (source was already green + SDK-confined → restructure IS the move); ② I initially
landed it as a near-verbatim copy + a thin re-export base and **forgot the agreed knowledge-style
foldering** — now done. The agreed shape is saved to memory (`providers-structure`) so it can't slip again.

This was the mission's next module (after knowledge ✅ + workspace ✅). Big + sensitive — the AI seam.

## The scope (what this pull is / is NOT)

**IN — `@vynel/providers`, the pure runtime seam only.** The old package is ~60 files:
`shared/` (the `AiAgentProvider` abstract class + 11 shared types + `active-session-registry` +
`pending-approval-registry`), `registry.ts` (`resolveAiAgentProvider` singleton `Map`), `claude/`
(the `ClaudeAiAgentProvider` + ~22 `internal/*` helpers), `test-support/fake-claude-query.ts`. **24
test files.** Deps: **`@anthropic-ai/claude-agent-sdk` + `@vynel/errors` only — NO `@vynel/db`.**

**OUT — deferred to separate, later pulls:**
- **provider-preferences CRUD** (`core/src/providers/*` + `core/src/skills/synchronize-skills-*`): the
  DB-touching feature that *consumes* the seam (`import … from '@vynel/providers'` + `@vynel/db`). ~8
  files. Its hub table **`provider_preferences` schema + repos is ALREADY in the kernel** (`packages/db/
  src/{schema,repositories}/providers/`, landed earlier). This is the natural fast-follow that makes the
  feature usable — but it's a downstream consumer, so it's its own move.
- **routes** (`apps/*/routes/providers/`), **③ agent-turn MCP binding + the approval CARD**, session/
  orchestration wiring. All follow-ons.

**Why seam-first:** the old repo *already* separated `packages/providers` (seam) from
`core/src/providers` (preferences) — we're preserving an existing boundary, not inventing one. The grep
proves the direction: preferences → providers + db; providers → neither. Zero-DB, self-mocking,
independently green-able. (Advisor-vetted.)

## Green-step facts (verified during scoping)
- **The whole suite is CLI-free.** `claude-ai-agent-provider.integration.test.ts` is a *mock-SDK*
  integration test (`vi.mock('@anthropic-ai/claude-agent-sdk', …)` + `fake-claude-query`). Nothing needs
  the real Claude Code CLI or auth → the gate is green on any machine. This was the #1 suspected risk; it
  isn't one.
- **SDK version:** declare `"@anthropic-ai/claude-agent-sdk": "^0.3.181"` to **match `apps/mcp` exactly**
  (one version line; 0.3.197 is just pnpm's resolution of that range — already installed).
- **The AI-seam invariant already holds in the source:** the SDK is imported ONLY inside `claude/`
  (impl + `claude/internal/*` + test-support). `shared/` and `registry.ts` never touch it. Faithful pull
  preserves this for free.

## Sanctioned exception to flag (do NOT let code-reviewer discover it)
- `claude/internal/read-host-os-env-var.ts` reads host env vars (to locate the Claude executable / detect
  auth). CLAUDE.md bans `process.env` outside each app's `env.ts` — but this is a legitimate **runtime
  boundary** read, not app config. **Blessed exception**; recorded here so it's deliberate, not flagged.

## Expectation after this pull (set with Chad up front)
`@vynel/providers` is green on its own 24 tests + typecheck, but **not yet wired to anything** — the ③
turn-composer MCP binding, the approval card, the preferences CRUD, and the routes are all follow-ons.
"Providers isn't doing anything end-to-end yet" is **planned, not incomplete.**

---

## Chad's standing directive (verbatim intent)
> Check **ALL** the old provider functions against the **latest** `@anthropic-ai/claude-agent-sdk`. Cover
> **all** available SDK functions (drop none) so they're usable as needed. Faithful pull → green → fold.

So the pull is NOT just a faithful move — it's a faithful move + an **SDK-capability audit**: enumerate the
old provider's functions, enumerate the current SDK surface, and make sure nothing usable is dropped.

## The AI-seam invariant (CLAUDE.md — do NOT violate)
- The `claude-agent-sdk` **runtime** (`query`, the session loop) may be imported **only** inside
  `packages/providers/src/claude/`. Everything else reaches it **only through `AiAgentProvider`**.
- The SDK's **builder** exports (`tool`, `createSdkMcpServer`, `SdkMcpToolDefinition`) carry no runtime and
  are already permitted in the MCP layer (`apps/mcp`) — that boundary is settled.
- Provider is neither a clean leaf nor a hub: the `provider_preferences` **schema stays in the kernel**
  (`@vynel/db/schema/providers`); `@vynel/providers` holds the runtime + logic (the `AiAgentProvider`
  contract + the claude implementation). Confirm the exact split during scoping.

## What this pull unblocks (why it's the natural next step)
The **③ agent-turn MCP binding + the approval CARD** were deferred to "the providers/composer phase" all
session (knowledge Stage-2 shipped its mutating MCP tools in *auto mode, no card* pending this). The
provider layer is the prerequisite for:
- `packages/mcp-contract` + `apps/mcp/build-in-process-server.ts` (`createSdkMcpServer`, in-process) +
  the `McpFeatureDescriptor` wrappers → wired into the api turn composer (`composeSessionMcpServers`).
- The real approval card ("we will have the approval improved" — Chad).
(See STATE.md "The 3 MCP directions" + "NEXT: providers/composer move".)

## Source (READ-ONLY reference)
Old repo `E:\KAFI\WORKSPACE\v2\vynel`, branch `refactor/session-library` (tip `754615f`). The provider
code lives there (confirm exact paths — likely `packages/providers` or a `core/providers` slice). Pull via
`git -C /e/KAFI/WORKSPACE/v2/vynel archive refactor/session-library <paths> | tar -x -C /e/KLONE/Workspace/vynel`.

## Chad's structural directive — the BASE (anti-corruption) layer
> "We will rebase in a folded way by keeping the functions in a base — if Anthropic makes any changes
> with their changelog we can easily just update the specific part. Many packages are going to use this
> library."

`@vynel/providers` is a **widely-consumed foundation** → its public surface must be stable and every
raw-SDK touch must be quarantined so an Anthropic changelog entry is a **one-file update**. Target shape:
- **`shared/`** = the PUBLIC contract, **SDK-free** (normalized types: `NormalizedSessionEvent`,
  `ApprovalDecision`, our own `PermissionMode` union…). This is what the many consuming packages import;
  an SDK change must NEVER reach their signatures. (Old wrapper already SDK-free here — keep it.)
- **`claude/base/`** (NEW in the fold) = the SDK ADAPTER, the **sole importer** of
  `@anthropic-ai/claude-agent-sdk`. Wraps `query` / `createSdkMcpServer` / `tool` and re-exports
  `SDKMessage`/`Options`/`PermissionResult`/hook types as **our-named** types. Anthropic changelog lands
  HERE, one place.
- **`claude/internal/*`** = the logic; imports from `claude/base/` + `shared/`, **never the SDK directly**.
  (Old wrapper imports the SDK in ~16 files → collapse to the single base choke point.)

**Sequencing (staged — respects move-then-improve):** ① faithful land as-is (SDK confined to `claude/`,
but still in ~16 files) → green · ② FOLD to `claude/base/` (sole importer; rewire the 16) → green · ③
audit-adopt new SDK surface *through* the base, each with a test. Three green checkpoints; the base is
step ②, not fused into the faithful land. **← confirm this vs fused-into-① before pulling.**

## SDK-capability audit (FOLD input — do NOT adopt during the faithful move)
`claude-code-guide` audited the *latest* `@anthropic-ai/claude-agent-sdk`. **Latest = 0.3.198** (2026-07-01);
our pin `^0.3.181` resolves to **0.3.197** installed. **NO breaking changes** across `query()`, `Options`,
`PermissionMode`, hooks, `createSdkMcpServer`/`tool` → the faithful pull typechecks against installed.

**New surface since 0.3.181** the old wrapper predates — weigh in the FOLD against Chad's "cover all, drop
none" (adopt deliberately, one at a time, each with its own test — NOT during the faithful land):
- **Session helpers:** `listSessions()` / `getSessionInfo()` / `getSessionMessages()` / `renameSession()` /
  `tagSession()`, and a custom `SessionStore` backend interface. Our wrapper currently hand-rolls
  session-artifact scanning (`synchronize-claude-persisted-sessions`, `fetch-claude-persisted-session-transcript`,
  `claude-session-storage`) — these SDK helpers may replace/augment that. **Highest-value fold candidate.**
- `startup()` pre-warm variant (latency); `Query.reinitialize()` (0.3.195, session reinit).
- `permissionMode` gained `dontAsk` + `auto` (old wrapper likely knows `default`/`acceptEdits`/`bypassPermissions`/`plan`).
- New hook events: `PostToolUseFailure`, `PermissionRequest`, `SessionStart`/`SessionEnd`, `Notification`,
  `SubagentStart`/`SubagentStop`; `prompt_id` added to hook inputs (0.3.196).
- `tool()` optional 5th arg `annotations` (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) —
  relevant to the auto-card model (readOnly = parallel-safe, destructive = needs approval).
- Per-server `request_timeout_ms`; 0.3.198 warns if `canUseTool` is set alongside `allowedTools`/`bypassPermissions`.

**Caveat:** the audit's exact type/field shapes (e.g. `continue_`, hook-output keys) are from docs prose —
**verify against the installed `.d.ts` during the fold**, don't trust the summary verbatim. The audit is the
map; the installed `node_modules/@anthropic-ai/claude-agent-sdk` types are the territory.

## The per-module loop for this pull
1. **Scope** → fill this doc: enumerate old provider functions + the current SDK surface (the audit), the
   `AiAgentProvider` contract, what's schema (kernel) vs runtime/logic (package), the known old-repo gaps.
2. **Outline the plan → get Chad's okay** (big change; his rule). Flag every real fork.
3. **Faithful pull → green** (gate = `pnpm test`), **then** fold/improve. Runtime ONLY in `providers/src/claude/`.
4. `code-reviewer` on the diff + green gate → prompt Chad to commit (conventional; NO AI identity).

## Watch-outs
- Latest SDK models to default to: **Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5** (see the harness model note) —
  the audit should not hard-code an old model list.
- Agents stall on long runs (>~9 min) here — keep agent tasks small or do it directly.
- When touching anything Claude/Anthropic-SDK-shaped, the `claude-api` skill is the source of truth — load it.
