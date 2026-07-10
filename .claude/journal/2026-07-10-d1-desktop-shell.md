# 2026-07-10 — D1: the real desktop app (Tauri main window + daemon sidecar + gateway)

**The move.** Chad opened the hosted-hub arc (auth · tiers · marketplace — discovery in
`docs/module-notes/cloud-api.md`, all forks resolved same day) and picked D1-first: make Vynel open
like a real app. Built: apps/local-api gains a **gateway** (`/api/*` strip-mount · `/voice/*` →
voice-daemon proxy · built local-web dist + SPA fallback · root passthrough); apps/desktop grows a
`main` window + release-mode **daemon sidecar** (spawn `node --import tsx`, port-probe health,
supervised respawn, kill on exit); `--jarvis-only` keeps voice wakes overlay-only. Gate 2053/4-skip;
gateway live-smoked (shell, assets, /api, passthrough, voice 502, traversal).

## Learnings worth keeping

- **A URL-space split needs a consumer census, not a comment.** The gateway gave `/voice/*` to the
  daemon proxy on the claim "the api's /voice has no root-path external callers" — the reviewer
  found `apps/mcp/external-server.ts` dispatches EVERY tool (incl. `voice.speak`) at root paths.
  Fix: all out-of-process consumers (MCP external, CLI) now dispatch via the `/api` mount — ONE
  external surface. When you carve a prefix out of a port's URL space, grep every `baseUrl`/base-URL
  construction first.
- **`new URL(path, base)` drops a prefix baked into the base** (absolute paths replace). Prefix
  mounts need string concatenation. Bit us in the MCP dispatcher fix itself.
- **Check-then-act across two mutex acquisitions is a race even in 40-line supervisors.** stop()
  between the supervisor's `stopping` check and its child-store orphaned the node daemon (port held
  after "exit"). Fix: one acquisition — check stopping AND store (or kill the fresh child) under the
  same lock. Residual exit-mid-CreateProcess sliver = D2 Windows Job Object.
- **Windows URL parsing eats your traversal test.** WHATWG URL collapses `..` AND single-encoded
  `%2e%2e` dot-segments before routing — a gateway-level traversal test needs the DOUBLE-encoded
  form to actually reach the resolver's containment guard. The resolver's second decode is what
  neutralizes double-encoding (now WHY-commented).
- **Hand-rolled static serving was right here**: @hono/node-server's serveStatic resolves `root`
  against process.cwd() — the same per-CWD bug class as the DB_PATH note. Absolute-root + tested
  containment beats a dependency with the wrong resolution semantics.
- **Vite-proxy rewrite removal** (`/api` forwarded verbatim) is what made dev and sidecar mode
  path-identical — one gateway contract everywhere instead of two path dialects.

## D2 punch-list (recorded in-code where it bites)

Windows Job Object kill-on-close · single-instance plugin + daemon ownership across processes
(--jarvis-only has no exit path) · tauri log plugin (windowed release swallows eprintln) · graceful
daemon shutdown handshake · SPAWN_ATTEMPTS lifetime cap → healthy-uptime reset · bundle Node runtime
+ installer (fork §9-F).
