# marketplace kinds — Phase C: the desktop installs non-skill kinds (module notes)

**Chad's ask (2026-07-12, closing his original #2):** items published from the admin portal —
agents, skills, rules, plugins, MCPs — must be installable from the app. Registry/hub is already
kind-agnostic (`skill|agent|mcp|rule|plugin`, manifest opaque hub-side by design: "a new kind needs
no hub change"); the desktop actively filters everything but `skill` at ONE line
(`resolve-merged-catalog.ts`).

## Slice C-agents (THIS build): skill + agent installable; the rest stay hidden

**Why agents first:** `installCuratedAgent → createAgent` is a proven catalog-definition→row
pipeline; the agents route header explicitly reserves "`POST /agents/install` from the marketplace
(community agents)". `mcp`/`rule`/`plugin` remain FILTERED from browse (comment says why) — honest
UI over dead Get buttons:
- `rule` waits for the instructions-notebook leaf (arc ④) — that's its install target.
- `mcp` needs two Chad calls: which leaf OWNS a standalone MCP install (today MCP config writes are
  a skills-internal side-effect), and whether it cards (skills' precedent is the silent write —
  but a standalone "add a server to ~/.claude.json" might deserve the approval card).
- `plugin` has no desktop semantics at all yet.

## The shape

1. **Contract:** `MarketplaceItem` gains `kind: 'skill' | 'agent'` (the DESKTOP union — only
   installable kinds ever reach the wire; widening later is additive). Bundled rows stamp 'skill'.
   `skillId` stays (= itemId for every row today — the id anchor, not skill-semantics).
2. **Merge:** `resolve-merged-catalog.ts` passes `skill` + `agent` cloud rows; mapper carries kind.
3. **Agent artifact = zip containing `agent.json`** (the manifest), sha256-verified like SKILL.md —
   the INTEGRITY story rides the artifact, not the DB-side `manifestJson` (which stays an opaque
   summary). `AgentItemManifest` contract (zod, validated AT INSTALL desktop-side): slug, name,
   description, prompt, icon?, model?, effort?, permissionMode?, allowedTools?, disallowedTools?.
   No `skillIds` v1 (cross-item dependency resolution is its own arc).
4. **`installCloudAgent`** (packages/agents/lifecycle, mirrors install-cloud-skill.ts): verify
   sha → extract agent.json (jszip; second private extractor after skills' — extract a shared home
   on the THIRD consumer) → zod-parse manifest → duplicate check by slug+scope → `createAgent`
   with `source: 'community'`, `trustTier: 'community'`. Agents' permission floor: carding is NOT
   tier-gated — the provider's PreToolUse hook enforces the tier-independent
   `TOOLS_ALWAYS_REQUIRING_APPROVAL` floor and the manifest schema clamps `permissionMode` to the
   safe subset; `trustTier` gates nothing at runtime today (a recorded provenance label reserved
   for future per-tier gating).
5. **Install-status per kind:** `annotate-with-install-status` keys skills by skillId; agents by
   slug. `MarketplaceDeps` gains an injected `listInstalledAgentSlugs` reader (marketplace may NOT
   import agents — sibling leaf; the app injects, per the leaf-decoupling recipe).
6. **Route dispatch:** the install route already has `cloud.kind` at the branch point — switch:
   'skill' → existing `installCloudSkill`; 'agent' → download+`installCloudAgent`. Response gains a
   kind discriminant; `api:generate` regen (parity gate).
7. **UI:** kind chip (Skill/Agent) beside Official/Pro in the marketplace card; Get works for both;
   composables thread `kind`.
8. **Seed:** `scripts/seed-catalog/<agent-item>/` with agent.json so Chad can publish an agent from
   the portal and install it in the app — the end-to-end smoke.

## Deferred (named, not silent)

- `mcp` kind (two forks above) · `rule` kind (rides arc ④) · `plugin` kind (undefined) ·
  update-flow ("catalog version > installed → Update") · shared artifact-extractor home ·
  bundled agents in the marketplace (curated agents already have their own surface).
- Slug-collision drift: a USER-created agent whose slug equals a catalog itemId flips that card to
  "Installed" (install-status keys agents on slug === itemId) — Phase-1 accepted.
- `createAgent` inserts its row without co-committing an outbox event (invariant 8) — a
  pre-existing gap inherited by this slice, not introduced here; its fix is its own move.
