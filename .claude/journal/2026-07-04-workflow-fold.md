# Journal — files/workspaces/agents concern-fold via a parallel Workflow (2026-07-04)

Chad asked to finish the fold sweep on the 3 remaining flat packages using a **Workflow** with parallel agents
(3 fold + 3 review), then test + commit. First time driving the fold work through the `Workflow` engine rather
than doing it by hand. It worked cleanly — 6 agents, 0 errors, all reviews CLEAN, gate green.

## The shape
A `pipeline([files, workspaces, agents], foldStage, reviewStage)`:
- **Fold stage** (general-purpose agent, one per package, parallel): read the flat logic → group by COHESION into
  concern folders → move with plain `mv` → rewire imports → self-verify (`grep` for stale `./` refs + scoped
  `pnpm --filter @vynel/<pkg> typecheck`). Returned a structured `FOLD_SCHEMA`.
- **Review stage** (`agentType: 'code-reviewer'`): verify behavior-neutral per its section (B), run its own
  typecheck, return `REVIEW_SCHEMA` (verdict/behaviorNeutral/mustFix).
The main session then ran the full `pnpm test` gate + committed one refactor commit per package.

## Why it was parallel-safe (verified before launch)
- The 3 packages are **mutually independent** (grep: no cross-imports) and **consumed only via their barrel**
  (`src/index.ts`, which stays put) — so a mid-fold package can't break a sibling's typecheck, and no external
  consumer dangles. Disjoint blast radius → true parallelism.

## The two techniques that made it clean
1. **plain `mv`, NOT `git mv`.** Three parallel folds doing `git mv` would contend on the single shared
   `index.lock`. Plain `mv` touches only the filesystem; the **main session runs `git add` afterward** and git
   detects the renames by similarity (89-100%). No git commands inside the agents at all.
2. **Reviewers reconstructed the rename-diff off the untracked tree.** Since the moves were plain-`mv` (untracked
   new files), `git diff -M HEAD` shows pure deletions. The reviewers independently worked around it — one via a
   throwaway temp index (`GIT_INDEX_FILE` in scratchpad, `read-tree HEAD` + `add -A` + `diff --cached -M`), another
   by diffing `git show HEAD:<oldpath>` against each disk file. Both proved every delta is a rename or an
   import-path edit, zero logic/comment/string change.

## Good judgment the fold agents showed (not prompted)
- **files:** put `file-content-kind.ts` IN `operations/` (imported exclusively by ops), and explicitly distinguished
  it from approvals' `derive-action-kind.ts` (a domain-wide table that stayed at root). Kept `file-watcher` at root
  as a standalone chokidar service.
- **workspaces:** DEVIATED from the suggested hint — kept `manager-name.ts` at root (persona-naming vocabulary, the
  structural twin of `derive-action-kind`) instead of burying it in `directory/`. It even consulted the advisor.
- **agents:** split on the entity-vs-projection axis (`lifecycle/` = AgentRow ops; `session/` = derived projections),
  left the existing `internal/` untouched.

## Learnings
- The `Workflow` engine (built-in) + a **custom pipeline script I authored inline** is the right tool for a batch of
  independent mechanical moves — parallelize the work, code-review each, one session stays in control of the gate +
  commit. Cost: ~400k subagent tokens / ~17 min wall for 6 agents.
- For parallel file-mutating agents on disjoint targets: **no isolation needed** (avoids per-worktree `pnpm install`)
  as long as targets are disjoint + agents avoid git/turbo; the main session does the git + gate afterward.
- The project `code-reviewer` agent is genuinely fold-aware (its section B) — it caught nothing to fix here because
  the folds were clean, and reported "clean" plainly rather than manufacturing findings.
