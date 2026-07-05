# 2026-07-05 — API completion: every remaining vertical, agent-driven

**Mission (Chad):** "complete api part only with spawning agents … goal is complete all of the
apis and start implementing ui." Executed as three waves of parallel port agents + a response-schema
sweep, main loop owning mounts/regen/gate/review/commits throughout.

## Landed (7 commits `512de7a..4a5c31a`, all local)

- **Wave A** — workspaces (8) · memory (7) · agents (8) · capabilities (2) · users (4) · files (10):
  six file-scoped sonnet agents in one Workflow, zero mount/dep edits by agents (the collision killer).
- **Wave B** — chat (12 + `streams/chat-turn` SSE) · root (6 + `streams/global-root-turn` SSE) ·
  routing (4 + `run-delegation-claim-and-run-tick` + `services/delegation-service`, boot-wired).
- **Wave C** — providers (3 + status ops → `packages/providers/src/status/`) · onboarding
  (`@vynel/onboarding` leaf, **decoupled via `OnboardingDeps` injection — zero sibling imports**,
  5 routes + first-launch gate behind `enableFirstLaunchGate`, server-only) · approvals workspace
  pending/audit + approval-rules (user queue → `user-scoped.ts` verbatim) · dashboard
  (`GET /dashboard/overview`, net-new per the UI demo contract).
- **Surface:** 34 → **109 paths · 131 SDK methods · 22 namespaces · 33 MCP tools** (29 main +
  4 routing in the separate global-root array). Gate **1835 passed / 4 skip**, unfiltered. Boot
  smoke: live spec serves 109 paths; schedules + channels + delegation services all start.

## The class bug of the day

**75 of 83 operations declared description-only 200s** → openapi-typescript emits `never` content →
every non-knowledge SDK method returned `Promise<never>`. Invisible for months because `never`
assigns to everything; it exploded the moment the UI accessed a property on a real response.
Fix: the knowledge `resolver()` pattern swept across all 13 groups (11 parallel agents, zero runtime
change), + a real generator bug (path params hardcoded `string`, broke on capabilities' enum param —
now indexed-access from the spec). **Rule going forward: no route lands without response schemas;
the golden surface tests + parity now encode the grown registry.**

## Learnings (autopilot mechanics)

- **Network drops kill agents mid-flight and they cannot be resumed** ("stopped by user" semantics).
  Relaunch-as-audit works well: both routing relaunches found the dead agent's work ~100% complete
  and just verified + filled tests.
- **Workflow resume cache can MISS** (all 4 agents respawned live despite 2 cached results) — a
  respawned porter will fight any live rewriter of the same dir. If a decoupling/improving agent is
  running over freshly-ported files, don't resume the port workflow; stop it and relaunch only the
  missing groups standalone.
- **Demo-seam collisions are the swap surfacing early**, not breakage: workspaces list is a bare
  array on the real wire (demo guessed an envelope), dashboard `workspaceId` is nullable (demo used
  a sentinel). Both fixed on the UI side — the schema declares the truth, never bends to the demo.

## Honest stops / still owed

- **`ChatTurnEvent` `approval-requested` still lacks `actionKind`** (the UI's inline card ask) —
  contracts change, deliberate, not slipped in.
- Desktop observation on the web root turn (no `@vynel/desktop-control` in local-api yet) — composes
  routing-only, documented precedent.
- Onboarding lifecycle writes carry no outbox events (faithful to source; plan deliberately if wanted).
- Route files >300 lines sweep (chat 397 the worst; `files/` shows the sanctioned sub-router split).
- CLI mirrors for the 14 new namespaces (Chad scoped this mission "api only").
- Reviewer verdict: MUST-FIX (HomeView null seam) closed; stale wired-comments closed; everything
  else CLEAN including seam/security/faithfulness sweeps.
