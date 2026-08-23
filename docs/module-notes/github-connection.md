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
2. **Git home + facts** ✅ — `packages/workspaces/src/git/run-git.ts` (ONE runner: `protocol.ext.allow=never` + `--no-optional-locks` on every call; scaffold + clone moved onto it; `describe-git-failure` shared), `read-git-facts` (ONE `git status --porcelain=v2 --branch` + `remote get-url origin`; `kind` = repository · not-a-repository · folder-missing · no-git · unreadable — every one a NORMAL 200; the folder is stat-ed first because a vanished cwd and a missing git both spawn-fail with ENOENT), `list-branches` (`for-each-ref`, tab-separated), `list-worktrees` (`worktree list --porcelain`, first block = main); `GET /workspaces/:id/git` [x-mcp `get_workspace_git_facts`, read] — `{ facts, branches, worktrees }`; the chat header badge "main · 3 uncommitted · ↑1 ↓2" (tooltip: remote · upstream · worktrees), refetched every 30s. Tests run against REAL git in a temp repo (`git/test-repository.ts`).
3. **Repo on Finish + Connect an existing workspace** ✅ — `@vynel/github` `createGitHubRepository` (`gh repo create <name> --private|--public --source <folder> --remote origin --push`; outcome `created { url } | failed { reason }` — gh's own last meaningful line; `ValidationError` before gh sees a name it could misread), `GitHubConnection.createRepository` (signed-in pre-flight → a `failed` outcome, never a throw); `POST /workspaces/:id/github/repository` → `{ outcome }` always 200 (no x-mcp — a session runs `gh repo create` itself). Wizard: the account step's offer (on by default when signed in; name = `suggestRepositoryName(appName)`, private) → Finish runs it AFTER the scaffold (`git: skipped` → failed outcome, nothing to push) → Done links or reports. Header: **Connect to GitHub** when `facts.kind === repository && remoteUrl === null` → `ConnectGitHubDialog` (shared `GitHubRepositoryFields`); signed out → "Open Settings". Push auth = the machine's credential helper (GCM on Git for Windows) — NOT `gh auth setup-git` (a global git-config change; Kafi decides).
4. **Sessions on a branch** — `session_worktrees` (sessionId loose ref · workspaceId · slug · branch · path · status) + MCP tools `create_worktree` (`git worktree add .claude/worktrees/<slug> -b <branch>`, records it, moves the calling session there), `set_session_location` (`root` | slug — Claude sets it while working), `list_worktrees`, `remove_worktree` (cards, destructive tier); `resolveSpawnedSessionRunCwd` and the primary's cwd follow the state from the next turn. The rail + Nodes say "on `<branch>`". No merge/PR tools — the manager's own git.

Not building: our own token handling, a GitHub API client, merge/PR orchestration, GitHub Actions, multi-account.

## Honesty lines

- `gh` missing / signed out is DATA the screen says plainly, never a 500.
- The sign-in code and URL come from `gh`'s own output; Vynel never sees or stores the token.
- A repository that could not be created is reported as such — the workspace is still fine.
