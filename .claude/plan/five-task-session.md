# Five-task session — 2026-08-02 (autonomous; Chad away after decisions)

Chad's directive: research first, resolve decisions with him (DONE — all below), then one
agent per task + code-reviewer per task, fix agents as needed, gate + commit + push per task,
final reverify + report saved to disk, then shut down the computer (CONFIRMED by Chad).

Model policy (Chad): complex → Fable, less complex → Opus 5.
Order: env-fix commit → T1 (Fable) → T4 (Opus) → T2 (Fable) → T3 (Fable) → T5 (Opus).
Rationale: T4 establishes scoping semantics T2's new views must follow; T2 builds the
commands reader T3's "/" menu reuses; T1 is cloud-isolated so it goes first while the
desktop surface is untouched.

Session rules: conventional commits, NO Co-Authored-By, push after commit, CHANGELOG.md
entry per task, reviewer per diff, full gate (`pnpm test`) before every commit.

## Settled decisions (Chad, 2026-08-02, via AskUserQuestion)

### Task 1 — admin catalog publish from GitHub URL / zip + credits + pickers
- **Repo import covers ALL FIVE kinds** (skill/agent/mcp/rule/plugin) — seed-bundle folder
  layout (descriptor JSON files) is the shape repo folders follow.
- **Categories are admin-defined and GLOBAL to all users**: the admin panel is the source;
  desktop renders any category verbatim — the silent `toSkillCategory → 'context'` coercion
  in `packages/marketplace/src/cloud-catalog-mapper.ts` must die.
- Icon picker = curated lucide allowlist, ONE home in `@vynel/contracts`, shared by portal
  picker + desktop `CATALOG_ICONS` map (decided by me — full-lucide silently renders
  monograms on desktop).
- Security (mine): https-only + github.com host allowlist, ref→sha resolve-then-pin,
  subpath selection, server-side zip validation at publish, reuse hardened `runGit`
  (extract from import-anthropic.ts), `protocol.ext.allow=never` stays.
- Credits: expose publisher fields (dropdown over existing publishers + "+ new publisher"
  incl. tier) + sourceUrl input. Fix the live bug: PublishVersionForm drops sourceUrl on
  every version bump.

### Task 2 — menus for rules/commands/agents/skills/mcps + custom MCP
- **Custom MCP auth = headers in config** (write `{type, url, headers}` into the Claude
  config — what Claude Code itself does). Never log header values; mask in UI.
- **Scope: both Global (~/.claude.json) and Workspace (.mcp.json) offered** — user manages
  their own gitignore; show a teaching note about workspace files being committed.
- MUST-FIX FIRST: the single writer `update-mcp-servers-for-scope.ts` writes
  `{command, transport}` for every server — remote needs `{type, url, headers}`; reader
  `list-claude-configured-mcp-servers.ts` reads `type` (asymmetry). Fix together.
- Rules view needs a NEW unfiltered reader (existing one hides hand-written rules);
  marketplace-managed rules get a provenance chip.
- Commands view/reader = greenfield (`~/.claude/commands`, `<ws>/.claude/commands`) — T3
  reuses it for "/".
- OAuth: deferred; v1 = static header auth.

### Task 3 — @ mention agents/personas, "/" skills+commands, "#" workspace
- **@agent = background run + report**: spawned/delegated session picks up the message,
  chat continues, result arrives as an incoming report box (existing send_message/
  delegation pipeline). @persona (workspace manager, e.g. @Mark) routes to that
  workspace's root the same way.
- **# = autocomplete of workspaces; on send the session becomes aware + gets read access
  to study that workspace** (live read-only cross-workspace capability bound ONLY to
  #-mentioned workspaces; workspace-scoped, not global ambient access).
- "/" lists skills + commands; selecting inserts into the input (Claude Code style),
  send executes as prompt text. Runtime already accepts slash prompts.
- Interaction (Chad, follow-up): @, /, # all behave the SAME way — typing the trigger
  character immediately pops an anchored menu of the mentionable options at the caret
  (agents/personas for @, skills+commands for /, workspaces for #); user picks by click
  or arrow keys and the token is inserted. One shared suggestion-menu component, three
  data sources. Filtering as the user keeps typing after the trigger is fine, but the
  menu appears on the bare trigger character itself — it is a mention picker, not a
  type-ahead-only autocomplete.
- Grammar in `@vynel/contracts` (one home, with offsets); server re-parse of
  userMessageText is the source of truth; client payload is a hint only. Reuse orphaned
  `packages/orchestration/src/agents/resolve-mentions.ts`. # is per-message in v1.

### Task 4 — Global menus show only global items
- Semantics settled by codebase precedent (channels/sessions/agents/marketplace):
  Global = items whose workspaceId IS NULL. Workspace tabs keep global+workspace fusion.
- Tier A: 6 one-line client fixes (Plans/Schedules/Tasks/Journal/SshServers/Notebook
  sections). Tier B: knowledge — new user-scoped route over existing
  `listGlobalKnowledgeSourcesForUser`. Tier C: memory — NEW repo fn + route (backend
  first or Global memory renders empty). Tier D: TasksPanel gets a SectionScope prop.
- One test encodes the wrong behavior (knowledge-memory-sections.test.ts) — update it.

### Task 5 — todo dock above chat input
- **Todos ≠ tasks** (Chad): a task has steps; those steps are todos. TasksPanel (right
  dock) STAYS as-is conceptually; the bottom dock is a separate session-scoped todo list.
- **Durable** todo rows (survive reload/resume), session-scoped, updated by the session
  via non-carding self-tools; user can mark done / remove from the dock. Auto-hides when
  empty. Claude Code-style presentation.
- Fix regardless: task/todo query invalidation on turn events (today task queries are
  never invalidated when Claude mutates mid-turn).

### Process
- Leftover env.ts repo-root fix: commit first as its own `fix:` commit (gate first).
- After final report (also saved to disk): Windows shutdown with 60s delay. CONFIRMED.

## Progress log (update as tasks complete)

- [x] Decisions resolved with Chad (all batches above)
- [x] Baseline gate + env-fix commit (fix was already committed pre-session, `430fb17`;
      baseline gate green 3488)
- [x] Task 1 — implement → review (1 MUST-FIX: symlink dereference in packItemFolder;
      2 SHOULD-FIX: repoDisplayUrl ordering, missing bodyLimit — ALL FIXED) → gate green
      3548 → committed. Playwright portal smoke after commit.
- [ ] Task 4 — implement → review → fix → gate → commit
- [ ] Task 2 — implement → review → fix → gate → commit
- [ ] Task 3 — implement → review → fix → gate → commit
- [ ] Task 5 — implement → review → fix → gate → commit
- [ ] Final reverify (full gate + cross-task review) + CHANGELOG + STATE.md + report
- [ ] Shutdown
