# marketplace kinds — Phase C: the desktop installs non-skill kinds (module notes)

**Chad's ask (2026-07-12, closing his original #2):** items published from the admin portal —
agents, skills, rules, plugins, MCPs — must be installable from the app. Registry/hub is already
kind-agnostic (`skill|agent|mcp|rule|plugin`, manifest opaque hub-side by design: "a new kind needs
no hub change"); the desktop actively filters everything but `skill` at ONE line
(`resolve-merged-catalog.ts`).

## Slice C-agents (THIS build): skill + agent installable; the rest stay hidden

**Why agents first:** `installCuratedAgent → createAgent` is a proven catalog-definition→row
pipeline; the agents route header explicitly reserves "`POST /agents/install` from the marketplace
(community agents)". Of the once-filtered kinds, only `rule` remains off the shelf:
- `rule` — Chad's call (2026-08-02): installs as plain `.claude/rules/*.md` files (native
  location Claude Code reads), no notebook-leaf dependency; its slice is next in Arc 3.
- `mcp` — SHIPPED 2026-08-02 (both forks settled by Chad): **config-is-truth** (no leaf owns a
  table; the scope's Claude MCP config IS the state, written via the skills leaf's single-writer
  ops in `packages/skills/src/mcp-servers/`), and **no card** (rides the workspace install tool
  at the standard mutatingApproved tier; the global root installs via delegation). Curation
  rule: two catalog items must never declare the same `serverName` (they would cross-match).
- `plugin` — SHIPPED (Phase B): delegates to Claude Code's own plugin system.

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

## Disk visibility (2026-07-14): installed agents land as files, like skills

**Chad's expectation (recorded here so every kind's arc inherits it): EVERY installable kind lands
as a visible file the user can see — "an agent md file inside .claude", exactly like skills write
SKILL.md.** The `rule` (→ notebook target) and `mcp` (→ ownership + carding forks) arcs must plan
their disk-visible artifact when they land.

**The SDK finding that shaped the design:** `build-claude-sdk-options.ts` passes
`settingSources: ['user','project','local']`, and the Agent SDK DOES load (and live-watches)
filesystem agents from `<cwd>/.claude/agents/` + `~/.claude/agents/` — **but a programmatic
`options.agents` entry takes precedence over a filesystem agent with the same name** (Agent SDK
subagents doc, verified against the docs 2026-07-14). Vynel resolves every ENABLED agent into
`options.agents` keyed by slug, so a same-slug file is always shadowed while the agent is enabled —
no double-registration.

**Design: a lifecycle-synced TRANSPARENCY MIRROR** (`.claude/agents/<slug>.md`; user scope under
`~`, workspace scope under the workspace — skills' scope-home convention). The DB row stays the
functional source; the file carries a "Managed by Vynel — edits here are not read back" header.
The sync is **load-bearing, not cosmetic**: a DISABLED agent leaves `options.agents`, so a leftover
file would go LIVE from disk. Hence: present ⇔ installed AND enabled —
- `installCloudAgent` / `installCuratedAgent` → `installMarketplaceAgent` (dup pre-check → mirror
  write disk-first → `createAgent` tx, mirror removed on a create race).
- `updateAgent` (source ≠ 'user') → rewrite while enabled / remove on disable / move on rename.
- `softDeleteAgent` (source ≠ 'user') → best-effort remove. Removal is always MARKER-CHECKED —
  a hand-authored `.claude/agents/*.md` is never destroyed.

**Deliberate scope:** marketplace/curated installs only. USER-BUILT agents (`createAgent` via
`POST /agents`) get no mirror yet — wider adoption is a follow-up call for Chad (it would also give
the in-app builder disk visibility, but needs a story for hand-edited files vs. the row).

## Deferred (named, not silent)

- ~~`mcp` kind~~ SHIPPED 2026-08-02 (config-is-truth, forks settled) · `rule` kind (plain
  `.claude/rules/` files — next Arc-3 slice) · ~~`plugin` kind~~ SHIPPED (Phase B delegate) ·
  ~~update-flow~~ SHIPPED (skills; gated on `hasCloudArtifact`) · shared artifact-extractor
  home · bundled agents in the marketplace (curated agents already have their own surface).
- ~~Slug-collision drift~~ — CLOSED (source-filtered) on 2026-07-12: the annotator now matches
  agents on slug === itemId AND `source === 'community'`, so a USER-created agent with a colliding
  slug neither shows "Installed" nor gets soft-deleted by `POST /uninstall`.
- `createAgent` inserts its row without co-committing an outbox event (invariant 8) — a
  pre-existing gap inherited by this slice, not introduced here; its fix is its own move.
