---
name: worktree
description: >
  Set up (or tear down) a Vynel git worktree that runs side by side with the main checkout:
  create the worktree, claim a free port band via `pnpm worktree:env`, install deps, and
  verify the instance boots on its own ports. Use whenever a task needs an isolated checkout
  — a parallel feature arc, a risky migration, or testing two instances at once.
allowed-tools: Read, Grep, Glob, Bash, Write
argument-hint: <branch-or-name> [remove]
---

Set up a Vynel worktree named/for `$1` so it runs **beside** the main checkout with zero port
collisions. If `$2` is `remove`, tear it down instead (see Teardown).

## Why this exists

Every Vynel port derives from `VYNEL_PORT_BASE` + fixed offsets (`packages/contracts/src/network/
ports.ts` — cloud-api +0, cloud-admin +1, engine +2, voice +3, local-web +4). A copied `.env`
would reuse the main checkout's band and every daemon would fight for the same ports. The
allocator gives each worktree its own band; the engine advertises where it actually bound in
`~/.vynel/engine.port` (band-suffixed for non-canonical bands), so clients of each instance find
their own engine.

## Setup steps

1. **Create the worktree** under the house location (`.claude/worktrees/<name>`), branching per
   the git convention (`feature/<name>` or `fix/<name>`, from latest main):

   ```bash
   git worktree add .claude/worktrees/<name> -b feature/<name> main
   ```

   If the branch already exists, drop `-b`. On this box git runs fine from WSL, but **pnpm and
   long-running dev commands go through `cmd.exe`** (Windows node owns the sockets).

2. **Claim a port band** — run the allocator FROM INSIDE the worktree (it resolves the checkout
   root from its own file location, so running the main checkout's copy is a no-op):

   ```bash
   cd .claude/worktrees/<name> && cmd.exe /c "pnpm worktree:env"
   ```

   It copies the main `.env`, skips bands claimed by the main checkout and sibling worktrees
   (running or not), bind-probes candidates in strides of 10, and writes `VYNEL_PORT_BASE=<band>`.
   It prints the resolved ports — read them back to the user. A relative `DB_PATH` means the
   worktree also gets its own database automatically; the script warns if an absolute path would
   share one.

3. **Install dependencies** (hardlinks from the pnpm store — fast):

   ```bash
   cmd.exe /c "pnpm install"
   ```

4. **Verify the band** — the cheapest real proof is the parse layer plus a boot:

   ```bash
   cmd.exe /c "pnpm dev api web"   # inside the worktree
   ```

   The engine must log `api listening` on `<band>+2` and Vite must print `<band>+4`. The main
   checkout's instance keeps running untouched. Alternatively `pnpm dev <apps> --base <band>`
   from any checkout shifts a one-off run without a worktree at all.

## Rules

- **Never hand-edit port numbers** into a worktree `.env` — bands come from the allocator so
  sibling claims stay visible to each other. One `VYNEL_PORT_BASE` line is the whole story;
  explicit `PORT`/`LOCAL_WEB_PORT` pins override the band and should stay commented out.
- The gate (`pnpm test`) and build discipline apply in a worktree exactly as in main.
- Secrets ride along in the copied `.env` — never commit it (it's gitignored; keep it that way).

## Teardown (`$2` = remove)

1. Stop anything running from that worktree (check its band's ports before killing).
2. `git worktree remove .claude/worktrees/<name>` (add `--force` only if the user confirms
   discarding uncommitted work — say what would be lost first).
3. `git branch -d feature/<name>` once merged (or `-D` with explicit user confirmation).
4. The removed worktree's `.env` disappears with it, freeing its band claim for future
   allocations — no registry to clean.
