# MCP tool-call hang audit (2026-07-26)

Chad's ask: *"MCP tool calls shouldn't get stuck — check if a tool needs more time to execute,
where it can break and get stuck."*

The question is narrow and answerable: for each of the 61 exposed tools, is every `await` on its
path bounded? A tool that never returns parks the calling agent with **no card, no error, and
nothing for the user to act on** — strictly worse than a failure.

## What was NOT done, and why

**No generic timeout wrapper on the generated in-process tool dispatch.** The generated handlers
call `app(url, init)` — Hono *in-process*, not HTTP. A `Promise.race` deadline there does not
cancel the route handler: on a mutating tool it would return "timed out" to the model while the
write is still in flight, the model retries, and the commit doubles. A deadline is only honest
where it genuinely cancels, so each fix below sits at the I/O boundary that owns the wait.

## Inventory

| Path | Bounded before? | Now |
|---|---|---|
| `send_task_to_workspace` / `send_task_to_session` / `report_to_requester` | ✅ enqueue-only, returns `{status:'enqueued'}` immediately; the tick runs under `routeRequest`'s `budgetMs` | unchanged |
| `send_to_channel` | ✅ synchronous DB enqueue | unchanged |
| `speak` | ✅ `AbortSignal.timeout(4s)` on the daemon call | unchanged |
| `start_app` / `stop_app` | ✅ supervisor SIGKILL grace 3s — "stop() must never hang" | unchanged |
| a parked approval (`canUseTool`) | ✅ `recoverStalePendingApprovals` — 60s tick + boot reap; **verified started at boot** (`server.ts:226`) | unchanged |
| `create_session` → `createSpawnedSession` → `runSeededSwapSession` | ❌ **drained a full SDK turn with no wall-clock bound** | 120s default, interrupts the session, actionable throw |
| `search_knowledge` / `search_memory` / `add_to_knowledge` / `add_memory_from_file` → `generateEmbedding` | ❌ **first call downloads ~23 MB from the HF Hub; a stalled download never rejects** | 120s bound on the *wait* |
| external stdio MCP server (`makeHandler`) | ❌ **real `fetch` with no signal** | `AbortSignal.timeout(150s)` + named timeout message |
| Zoom REST (`zoom-api.ts` × 3) | ❌ no signal — a wedged call holds the poll tick open | `AbortSignal.timeout(15s)` |

## The three fixes

1. **`runSeededSwapSession`** (`packages/session/src/runtime/`) — races the drain against
   `timeoutMs` (default 120s) and, on expiry, **interrupts the session** before throwing. The
   interrupt is the point: abandoning the await alone would leave a live turn nobody reads.
   `FakeAiAgentProvider.interruptChatSession` went from a throwing stub to a recorder, since
   interrupt is now a real path a test asserts on.

2. **`generateEmbedding`** (`packages/embeddings/`) — bounds the **wait**, never the load.
   `pipeline()` takes no `AbortSignal`, and abandoning a half-written model file is exactly the
   truncated-cache failure the file already documents — worse, a retry would start a *second*
   download over the same path. So the in-flight promise keeps running (the next caller attaches
   to it, possibly warm); only this caller gives up, with a message saying the download continues.

3. **`external-mcp-server.ts`** — the one place a wrapper deadline is unambiguously correct: real
   HTTP, so the signal cancels, and an outside MCP client has no approvals reaper behind it. The
   150s budget is a **transport backstop, not a per-route budget** — it must stay above the
   slowest internally-bounded route (`create_session`, 120s) or a legitimate spawn reads as a
   timeout. A `TimeoutError` is renamed before it reaches the model ("This operation was aborted"
   tells it nothing).

Zoom's three fetches were swept in the same pass — same class, same fix.

## Recorded, not done

- **`packages/channels` telegram** goes through telegraf, which owns its own HTTP timeouts — not
  re-verified here.
- **`ssh-servers`** exec is not MCP-exposed today; when it is, it needs the same treatment (the
  route already has a friendly-failure comment mentioning a timeout — confirm it is real).
- The gate ran green after these changes: **575 files / 3176 tests**.
