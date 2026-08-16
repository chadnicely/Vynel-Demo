# `@vynel/processes` — background processes (built 2026-08-17)

Kafi's ask, out of the session-comms naming session: *"a session wants to run `pnpm test` and keep
doing its task — even paused — and the run completes and notifies it."* Claude Code's background
shell, in Vynel's shape: the command outlives the turn that started it, and the **exit wakes the
owner** instead of anyone polling.

## The shape

One new leaf package, one table, four tools, zero new delivery machinery:

```
run_background_process        POST /processes            (mutating, ask-tier card)
list_background_processes     GET  /processes            (read)
get_background_process        GET  /processes/:id        (read)
kill_background_process       POST /processes/:id/kill   (mutating, uncarded — own process)
```

- **The row** (`background_processes`) is the durable record: owner (kind + loose session ref,
  the monitors vocabulary), command, cwd, status `running/succeeded/failed`, exit code,
  failure reason (`spawn-failed / killed / timed-out / restart`), bounded output
  tail (8KB persisted, 2KB in the event), and a REQUIRED `timeoutMs` ceiling (default 30m,
  max 24h — the tool-hang-audit rule applied to OS processes).
- **The child** lives in `BackgroundProcessRunner` (one per api process, DI'd through the
  factory env like the app supervisor) and dies with the api process; the **boot sweep**
  settles rows a crash left running, so their failure events still fire.
- **The wake is a monitor.** Exit co-commits `process.completed` / `process.failed` (two types
  so "wake me only on failure" is a plain type subscription); the run route **auto-arms a
  `once` monitor** on the calling session filtered to the processId — app-tier composition of
  two leaves. The route test pins that the armed monitor MATCHES the real settle event.
- **One name on every surface** (`rootSurface` + `workspaceSurface`, the send_message rule);
  ownership is ambient (caller header → spawned session; scope → workspace primary; bare →
  global root) — the model never names who gets woken.

## Decisions locked

- **Package-per-feature over a shared process core** (Kafi): `@vynel/apps`' hardened
  `AppProcessSupervisor` could not be imported (sibling leaves), so the runner re-implements
  the mechanics — settle-once ('error' vs 'close'), Windows tree-kill via taskkill,
  SIGTERM→SIGKILL grace, ring buffer. **The two files cross-reference each other; a
  process-mechanics fix in one must sweep the other.**
- **`run_background_process` rides the ASK tier** (`x-mcp.askApproval`, the delete_agent
  shape): cards in ask mode, uncarded in auto/bypass — Chad's 2026-07-26 stance (feature tools
  never card in auto/bypass; the every-mode floor is native-tools-only), re-affirmed by Kafi
  when an every-mode card was briefly tried. Recorded asymmetry: a delegated bypass turn's
  native Bash still cards via the provider floor while this does not — Chad's knob if it ever
  bothers him. The review's real catch stands either way: a descriptor-only card declaration
  is STRIPPED by the policy layer unless the catalog's cardClass agrees (pinned at the
  composed level in compose-session-mcp-servers.test.ts). `kill` is own-bookkeeping
  (the stop_monitor rule, uncarded).
- **Naming**: "background process" — after the same session renamed "background runs" to
  delegated tasks. Three nouns, three things: *delegated task* = work given to a session ·
  *background process* = a command on the machine · *monitor* = the watch that wakes you.

## Gaps / deferred

- **No UI surface** — tool-only today (the Tool access panel lists them; no processes panel).
- **Shutdown kills children synchronously but cannot settle their rows** (the handler exits
  before the async settle callbacks run) — those rows settle at the NEXT boot's sweep as
  `restart`. Deliberate; the alternative is blocking shutdown on child close events.
- **agent-session callers** map to their workspace/global scope (monitors have no agent owner
  kind), so a colleague's wake lands on its grounding conversation.
- `cwdRelative`, env-var injection, stdin: deferred until a real need.
- **Live smoke PASSED (2026-08-17, Kafi):** run → background → wake → absorb → report, end
  to end on a real workspace ("pnpm test passed — green"). Two polish fixes came out of it:
  ANSI escapes now strip at capture (both twins — get_app_logs had the same garbage), and the
  monitor wake renders the payload as readable lines (scalars first, multi-line tails as real
  text blocks) instead of one JSON blob. The wake stays a VISIBLE collapsed card, not a hidden
  message — the trust doctrine wants the "why did Claude wake" receipt one click away.
- The wake's readable shape on a LIVE session (monitor fire → wake turn narrating exit code +
  tail) is pinned mechanically (matcher test) but not yet observed in a live smoke — check it
  in the next end-to-end pass alongside the note-kind smoke.
