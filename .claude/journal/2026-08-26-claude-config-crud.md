# 2026-08-26 — Claude config CRUD: rules · commands · skills · agents

**Ask (Kafi):** finalize the four `.claude/` areas — user (UI) and Claude (MCP) create / edit /
delete; on-disk files discovered consistently; skills multi-file. Design record:
`docs/module-notes/claude-config.md`. Worktree `.claude/worktrees/claude-config`.

## What the audit said (four Explore agents, one per kind)

Only two kinds were truly "not discovered": hand-authored agents (no scan at all) and skills (the
sync existed but only the CLI ever called it). Rules and commands were already listed from a live
scan; what they lacked was any write path. Real bugs: skills uninstall recomputed the folder from
`skillId`; a hand-authored skill named like a catalog item flipped the Marketplace card; settings
updates committed the row before writing disk; the rules lister accepted names the writers refused.

## Decisions (Kafi)

- **No new tables.** Files are the truth for rules / commands / hand-authored agents; skills keep
  their row (health + settings) and the row set now reconciles with disk on every shelf read.
- **Mirror every agent source** (Slice 4) — closes the user-built-agent asymmetry.
- **Per-kind tools** with descriptive names; native Write/Edit stays a valid door in a workspace
  session, the tools are the correct one for the global scope, marker/mirror safety and the card.

## Learnings

- **One safe-name predicate, shared by the lister and the writers.** The rules bug class was two
  predicates drifting; `isSafeFileStem` is structural (one path segment) rather than a charset —
  and the reviewer caught that Windows-reserved characters must be in it: `foo:bar.md` on NTFS
  silently writes an alternate data stream, a zero-length file that never lists.
- **Rows carry what the editor edits.** The web must never re-parse a file the leaf already
  parsed (`body` on rule + command rows; the command writer keeps unmodelled frontmatter keys).
- **Sync-on-read needs write-on-change.** Reconciling on every list is only acceptable because a
  row's health is touched only when disk disagrees — otherwise a read path becomes a write per row.
- **Provider discovery takes the leaf's home seam** (`userHomeDir`): the alternative — route tests
  scanning the developer's real `~/.claude/skills` and inserting phantom external rows — is exactly
  what would have happened the moment listing synced.
- **No prettier config in the repo.** `prettier --write` reformats every engine file (single
  quotes, no semicolons, width 100 by hand); only `local-web` matches the defaults. Reverted a
  476-line churn once; never again outside `apps/local-web`.
- **The developer's real `~/.claude.json` is written by tests.** Workspace-scope MCP-config tests
  approve project servers in the user config without the home seam; two vitest workers tore the
  write and left junk after the document (repaired from backup). Its own move.
- **CRLF check before multi-line replaces** (memory) held again — a bash-quoted node one-liner
  wrote real newlines into a TS string literal; a scratchpad `.mjs` with `\r?\n` is the tool.

## Numbers

Gate 1 (rules): 1041 files / 7081 tests · Gate 2 (+commands): 1043 / 7095 · reviewer on the
rules+commands diff: 1 must-fix (reserved characters) + 6 should-fixes, all closed. Tools: 121 →
132; catalog entries 151 → 162.

## Slice 4 — agents (same day)

- **`createAgent` = the mirror choreography for every source.** The old `installMarketplaceAgent`
  became the public `createAgent`; the row insert is `createAgentRow` (internal). Update and
  soft-delete dropped their `source !== 'user'` guards. Consequence discovered the hard way: every
  test that created a USER-scope agent without the home seam wrote a mirror into the developer's
  real `~/.claude/agents` — seven files, removed by marker + mtime. Tests that only need a row
  now use `createAgentRowForTest` (`@vynel/agents/test-support`); tests that go through the API
  isolate the home per test with `beginHomeDirOverride`. Lesson: **a disk-writing op reached by
  fixtures needs a row-only door for tests, or every fixture is a write into someone's home.**
- **Hand-authored agent files stay files.** `listFileAgentsForScope` skips mirrors (the marker),
  `writeFileAgentForScope` demands a loadable frontmatter (`name` = stem, `description`) and
  refuses a mirror path or a slug Vynel owns at that scope (two definitions, one name, no honest
  answer). The shelf lists them "On disk" with a raw editor.
- **`isSafeFileStem` moved to `@vynel/contracts/fs`** — both leaves list and write `.claude/`
  files and leaves never import each other; the skills copy is a re-export.
- Skills reviewer pass closed in the same window: sync-on-list dedupes discovered names (a copied
  folder can no longer 500 every shelf read), a missing-on-disk row uninstalls, skill file paths
  use the shared stem predicate per segment, directory targets 404, create is `wx`-exclusive,
  the editor parks a file switch while dirty, the synced read + by-scope getter live in the leaf.
