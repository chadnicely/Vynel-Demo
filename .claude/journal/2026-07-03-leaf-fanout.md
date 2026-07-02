# 2026-07-03 — parallel leaf fan-out (capabilities · files · memory · approvals)

First **parallel-agent fan-out**: four dep-clean, knowledge-shaped leaf packages pulled at once, each by a
background agent in its **own git worktree** (`.claude/worktrees/`, gitignored), each **code-reviewed** before
integration. Committed as one integration commit `631ceb2`.

**Why fan-out was safe here:** the four leaves are independent — each imports only the kernel + allowed lower
layers, never a sibling leaf (architecture rule 2), and their schema+repos already live in the KLONE kernel.
So each agent touched ONLY its own `packages/<leaf>/` — zero shared-surface collision. The blocker analysis
that preceded this proved the shared "foundation" packages (`config`/`pubsub`/`feature-flags`/`queue`) are
empty unused stubs, NOT blockers — so nothing needed pre-building.

**The four (all faithful pulls + comment-polish, all green):**
| leaf | files | tests | deps |
|---|---|---|---|
| capabilities | 11 | 8 | `@vynel/db` |
| files | 31 | 113 | `@vynel/db` + `chokidar` (file-watcher) |
| memory | 30 | 37 (vec/FTS live) | `@vynel/db` + `@vynel/embeddings` + errors/logger |
| approvals | 24 | 65 | `@vynel/db` + errors/logger + `@vynel/providers` |

**Mechanics that worked:** launch 4 `general-purpose` agents with `isolation: "worktree"`, each running the
faithful-pull protocol (git-archive old `packages/<leaf>` → wire package.json `exports`/`workspace:*` → strip
dead doc-citations → `pnpm install` + typecheck + `vitest` green → commit on `pull/<leaf>`). Then a
`code-reviewer` agent per branch (all **PASS**; three byte-verified faithfulness vs the old source). Integrated
by `git checkout pull/<leaf> -- packages/<leaf>` for each (avoids lockfile-merge churn) → fixed the 3 comment
nits the reviews caught (stale `@vynel/core/*` / `apps/api` refs) → one `pnpm install` to reconcile the lock
(+chokidar, already in store) → full gate → single commit.

**Gate green:** typecheck (22 pkgs) + parity (schema 30 / mcp 7 / sdk 7·8, unchanged) + vitest **900 pass /
4 skip** (was 677; **+223**).

**Deliberately deferred (NOT in this pull):** the **vertical-slice** (move each leaf's schema+repos from the
kernel INTO its package, the full knowledge shape) + the **routes/sdk/mcp** surfaces — both are high-collision
shared-surface work, done serially later. `session` (composition) is a focused single-session build. `agents`
leaf waits on the `contracts/agents` schemas.

**Windows note:** `git worktree remove` fails on the agent worktrees (`Filename too long` on deep node_modules);
dirs are gitignored + harmless, nuke later with a long-path-capable delete.
