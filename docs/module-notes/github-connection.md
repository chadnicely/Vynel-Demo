# GitHub + git — the connection, the facts, repos on Finish, sessions on branches

*Branch `feature/github-connection`. Kafi's decisions 2026-08-23 (after the wizard arc). Read before
touching any slice.*

## The ask

Create repositories for workspaces, show what branch a workspace is on, and let a session work on
its own branch in its own worktree — the way Kafi works: a worktree → the full gate → the reviewer →
merge to main, with the **workspace manager deciding who works where and when to merge**.

## Decisions (Kafi, 2026-08-23)

| Fork | Call |
|---|---|
| How Vynel talks to GitHub | **Through `gh`, never our own OAuth app or API client.** `gh` covers the whole API (`gh repo create`, `gh pr create`, `gh api …`), signs in with GitHub's device flow, keeps the token in the OS credential store, and — the decisive point — **the sessions already have `git` and `gh` on Bash**, so PRs, issues and reviews are things Claude *does*, not features Vynel reimplements. |
| Git transport (push/pull/clone) | **Git Credential Manager** (ships with Git for Windows) or `gh auth setup-git` — whatever the machine has. Vynel never handles git credentials; every `git push` a session runs already goes through it. |
| The cost of `gh` | It is not part of Git for Windows. v1 = detect and offer the install (`winget install GitHub.cli` / `brew install gh` + cli.github.com); bundling it as a sidecar (like the voice daemon) is the later move if the offer proves too much for non-technical users. |
| Accounts | **Global** — one GitHub sign-in for the whole app (Settings → GitHub), never per workspace. Same rule as the Claude account. |
| Worktrees | `.claude/worktrees/<slug>` inside the workspace (our own dev recipe's location). |
| Who orchestrates | **The workspace manager, not Vynel.** Vynel keeps the STATE of where each session runs and follows it; sessions create worktrees when they need them and say where they work through MCP tools; merges and PRs stay the manager's own `git`/`gh` on Bash. The primary session runs on the root by default. |

## Slices

1. **GitHub connection (global)** — `@vynel/github` leaf: `readGitHubAuthStatus` (`gh auth status`, stdout+stderr, exit 1 = signed out, spawn error = not installed), a `GitHubSignInRelay` (`gh auth login --web` on a non-TTY spawn: the one-time code + `github.com/login/device` captured from its output and shown IN the app, the process polled to its verdict — the Claude login relay's shape), `signGitHubOut`; one stateful `GitHubConnection` injected at `createApp` (the `aiProvider` precedent, a fake in tests). Routes `/github/connection` (GET status · POST sign-in → `{ loginId, userCode, verificationUrl }` · GET/DELETE sign-in/:loginId · DELETE = sign out), no x-mcp (a session runs `gh auth status` itself). Settings → **GitHub** section; the wizard's account step shows the real handle.
2. **Git home + facts** — `packages/workspaces/src/git/run-git.ts` (scaffold + clone move onto it), `read-git-facts` (branch · ahead/behind · changed · untracked · remote; a non-repo is a NORMAL answer), `list-branches`, `list-worktrees`; `GET /workspaces/:id/git` [x-mcp `get_workspace_git_facts`, read]; the facts on the workspace header.
3. **Repo on Finish + Connect an existing workspace** — screen 9's repo name / visibility fields return only when `gh` is signed in; Finish runs `gh repo create <name> --private|--public --source . --push` after the scaffold, reported honestly (created / skipped / failed); "Connect to GitHub" on any workspace = the same command. Push auth = the machine's credential helper.
4. **Sessions on a branch** — `session_worktrees` (sessionId loose ref · workspaceId · slug · branch · path · status) + MCP tools `create_worktree` (`git worktree add .claude/worktrees/<slug> -b <branch>`, records it, moves the calling session there), `set_session_location` (`root` | slug — Claude sets it while working), `list_worktrees`, `remove_worktree` (cards, destructive tier); `resolveSpawnedSessionRunCwd` and the primary's cwd follow the state from the next turn. The rail + Nodes say "on `<branch>`". No merge/PR tools — the manager's own git.

Not building: our own token handling, a GitHub API client, merge/PR orchestration, GitHub Actions, multi-account.

## Honesty lines

- `gh` missing / signed out is DATA the screen says plainly, never a 500.
- The sign-in code and URL come from `gh`'s own output; Vynel never sees or stores the token.
- A repository that could not be created is reported as such — the workspace is still fine.
