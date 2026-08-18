# Live channel — one multiplexed real-time connection per window (research + plan)

*Opened 2026-08-19 from Kafi's ask: "it needs to work with multiple workspaces gating multiple
agents — research first, then a proper plan." Supersedes the follow-up list in
`live-streams-socket-budget.md` (that note keeps the incident record + the how-to-verify recipe).*

---

## 1. The problem, in numbers (verified)

The UI opens one HTTP connection per live thing and every browser engine caps **HTTP/1.1 at 6
connections per host, shared by every tab/window of the same origin**. Vynel's origin is one host
everywhere: `localhost:18894` (vite dev) or `127.0.0.1:18892` (the engine gateway the Tauri
windows load from — `apps/desktop/src-tauri/src/windows.rs`, `tauri.conf.json frontendDist`).

**Tauri is not exempt.** WebView2 (Windows) *is* Chromium — same network stack, same pools — and
`create_windows` builds THREE webviews at launch (main, jarvis hidden, desktop-overlay hidden), all
one origin, all sharing the 6:

| standing stream                        | main | jarvis | overlay |
|----------------------------------------|:----:|:------:|:-------:|
| `/api/activity/stream` (feed)          |  1   |        |    1    |
| `/voice/events` (voice EventSource)    |  1   |   1    |         |
| **idle total: 4 of 6**                 |      |        |         |

Add one running turn (its own POST stream, 1) and one live watch (`/sessions/:id/stream`, 1) → **6**
→ every poll, every send, every detail read queues in the browser with no error. It reads as
"the workspace is idle / the engine is stuck" while the API answers in milliseconds.

Verified twice on 2026-08-18: two tabs during a long turn (the "frozen tab", fixed partially by
`f57cb34`'s attach gate), and three tabs with **nothing running** — the `POST …/turn` sat pending
until a tab was closed (playwright, `.claude/STATE.md`). `f57cb34` bought headroom (idle 4 → 2 per
tab); it did not change the shape. "N workspaces × M agents live at once" is unreachable on
one-connection-per-thing.

## 2. Research findings

1. **Chromium socket pools** (`net/socket/client_socket_pool_manager.cc`, main):
   `g_max_sockets_per_group = { 6 /* kNormal */, 255 /* kWebSocket */ }`, per-pool soft cap 256
   each. WebSockets live in their **own pool** — a WS connection costs the HTTP pool nothing, and
   a host may hold 255 of them. (websocket.org's "6 per origin for WS" is wrong for Chromium.)
   WebView2 = Chromium ⇒ identical. macOS Tauri (WKWebView) — HTTP/1.1 is also 6/host; the WS
   ceiling is high but must be verified on a Mac before we rely on more than a handful.
2. **SSE has no multiplexing on HTTP/1.1** — each `EventSource`/streaming `fetch` is a socket.
   HTTP/2 would lift the cap (100 streams/connection) but browsers only speak h2 over TLS; a
   loopback dev/desktop origin won't carry a trusted cert. Ruled out.
3. **Hono now has WebSockets built in on Node.** `@hono/node-server` **2.0** (2026-07) ships
   first-class WS: `import { serve, upgradeWebSocket } from '@hono/node-server'`, pass
   `websocket: { server: new WebSocketServer({ noServer: true }) }` to `serve()`. Requires the
   `ws` package (already a dependency of `@vynel/channels`) and Node ≥ 20 (we run 22). The public
   API is otherwise unchanged from 1.x (only the Vercel export went away); `@hono/node-ws` is the
   deprecated predecessor. So the earlier "don't add ws, Hono only has SSE built in" no longer
   holds — WS *is* the built-in now. Caveat from the docs: header-mutating middleware (CORS) on
   the WS route errors on immutable headers — mount the route before such middleware.
4. **Vite dev proxy** forwards upgrades with `proxy['/api'].ws = true`; the Tauri gateway
   (`apps/local-api/src/gateway.ts`) is the very Hono app `serve()` runs (`boot.ts:462`), so the
   WS route mounts there ahead of the `/api/*` fetch-forward (a fetch re-dispatch cannot carry an
   upgrade).
5. **Remote-engine mode**: the browser `WebSocket` API cannot set `Authorization`; the desktop
   tunnel that injects the bearer header on requests must do so on the upgrade too (it is a
   plain HTTP GET) — verify; fallback is a first-frame token.
6. **Server side already multiplexes internally**: `TurnEventBroadcaster` keys channels
   (`session:<id>`, the delegation trace key), `SessionActivityFeed` replays in-flight turns on
   subscribe. What is missing is ONE transport that carries many channels to one client.

## 3. Options

| option | per-window cost | pool left for polls | scope | verdict |
|---|---|---|---|---|
| A. keep SSE per thing, leader-elect feed+voice across windows (Web Locks + BroadcastChannel) | 2 shared + 1 own + W watches | thin | small, but frozen-leader heartbeat, doesn't scale watches | no |
| B. **one multiplexed SSE `/live` per window** + control POSTs | 1 (+1 own turn until slice 4) | 3–4 of 6 across 3 windows | medium | good, but voice + own turns MUST migrate to fit |
| C. **one multiplexed WebSocket `/live` per window** | 0 from the HTTP pool | all 6 | medium (dep bump) | **recommended** |
| D. HTTP/2 | — | — | needs TLS on loopback | no |

**Recommendation: C.** Same multiplexer core as B (the hub is transport-blind), but the standing
connections leave the HTTP pool entirely, so polls never compete with live data, voice and
own-turn migrations become optional follow-ups instead of prerequisites, and "N workspaces × M
agents" is N×M subscriptions on one socket. B stays the fallback if the dep bump surprises us.

## 4. Design — the Live Channel

### Server (`packages/session/src/runtime/live-channel/`, wired in `apps/local-api`)

- **`LiveChannelHub`** — stateful (class): `connections: Map<connectionId, {userId, send, channels:Set}>`.
  Bridges the two existing sources onto per-connection frames:
  - `activity` → `SessionActivityFeed.subscribe(userId)` (its replay-on-subscribe stays);
  - `session:<id>` / `trace:<partialId>` → `TurnEventBroadcaster.subscribe(key)` (ownership check
    on subscribe: unknown/not-owned = the same 404-shaped `error` frame as the SSE routes);
  - later `turn:<turnId>` (slice 4) and `voice:<surface>` (slice 5).
  One broadcaster subscription per (hub, channel) — refcounted across connections; frames are
  serialized once and fanned out. Unsubscribe on last leaver; everything torn down on close.
- **Wire frames** (JSON, one per WS message):
  `{v:1, kind:'hello', connectionId}` · `{kind:'subscribed'|'unsubscribed', channel}` ·
  `{kind:'event', channel, event}` (the event is the SAME `ChatTurnEvent` / `SessionActivityEvent`
  today's SSE carries — no new vocabulary) · `{kind:'channel-ended', channel}` (a session/trace
  channel's `onEnd`, = today's `turn-stream-ended`) · `{kind:'error', channel?, code, message}` ·
  `{kind:'ping'}`. Client → server: `{op:'subscribe'|'unsubscribe', channels:[…]}` (idempotent),
  `{op:'pong'}`.
- **Route** `GET /live` (upgrade) mounted on the gateway app before `/api/*`; user resolution as
  the SSE routes (`userScoped`); heartbeat every 25 s, close after two missed pongs.
- **Limits**: max subscriptions per connection (e.g. 256), max connections per user (e.g. 16),
  bounded outbound queue per connection (drop the connection, not the process, on backpressure).
- The existing SSE routes (`/activity/stream`, `/sessions/:id/stream`, `/root/trace/:id/stream`,
  the POST turn streams) **stay** — the CLI/MCP consumers and the voice daemon's brain client
  use them; the web app simply stops.

### Client (`apps/local-web/src/composables/live/`)

- **`useLiveChannel()`** — one per app instance (AppShell, Jarvis, overlay each get exactly one):
  connect (`ws(s)://<origin>/api/live`), backoff reconnect (1 s → 15 s), **resubscribe the full
  channel set on reconnect** (the server replays the activity snapshot; session channels seed
  from persisted rows as today), stall detection (no frame incl. ping for 60 s → reconnect),
  refcounted `subscribe(channel, onFrame) → release`.
- **`use-session-activity-feed`** → `subscribe('activity')`; `resetServerTurns` on disconnect as
  today.
- **`live-turn-registry`** → `subscribe('session:<id>' | 'trace:<id>')` instead of its own fetch
  loop. **The attach gate goes away** (an idle subscription costs nothing now) — the registry
  becomes: subscribe while displayed, seed on the first frame, settle on `channel-ended`,
  keep listening. Simpler than today.
- Nothing else in the UI changes: `applyChatTurnEvent`, the seed, the overlays, the pointer rail
  all read the same events.

## 5. Slices (each: tests + green + reviewer, then the next) — status 2026-08-19: ALL SHIPPED (1–3 `9093297` `8fb2545` `16a5797`; 4 `1ac30e6` as the client-side detach — the send holds its stream only until the watch has the turn, no route change; 5 `8b09804`; 6 free with them). Per window at idle: 0 HTTP-pool connections; while sending: 1 for ~the first frames.

1. **Server hub + WS route** — bump `@hono/node-server` → 2.x, add `ws` to `apps/local-api`,
   `LiveChannelHub` with vitest coverage (real `ws` client against a bound port: hello, subscribe
   activity → snapshot replay, session channel → events + channel-ended, ownership 404-frame,
   refcounted broadcaster subscriptions, disconnect cleanup, heartbeat close), gateway mount,
   vite `ws: true`. Gate: `pnpm test` (typecheck + parity + vitest).
2. **Client channel + activity feed on it** — `useLiveChannel` + tests (fake WS), the feed
   composable rides it; the SSE feed path in the web app is deleted. Verify: 3 playwright tabs at
   idle → the pool shows only polls; the send POST goes through.
3. **Registry watches on it** — `live-turn-registry` subscribes via the channel; the gate and the
   per-entry fetch loop go; tests rewritten to the new shape. Verify: A→B→C in one tab, revisits
   live; three tabs each on a running workspace, all live, polls unaffected.
4. *(optional, recommended)* **Server-owned turns** — `POST …/turn` returns `202 {turnId,
   sessionId?}` and the turn's frames ride `turn:<turnId>` (the requesting connection is
   subscribed *before* the turn starts via an `X-Vynel-Live-Connection` header — no lost early
   frames); the own-turn overlay becomes a channel consumer. Removes the last per-window HTTP
   stream and makes in-app tab switches stop tearing the origin stream. Bigger: touches the three
   turn routes — plan it as its own arc.
5. *(optional)* **Voice relay** — the API subscribes to the daemon once per surface with a live
   subscriber and republishes on `voice:<surface>`; keeps the four-party audio ownership rules
   (`voice-audio-ownership-and-instruction-decay`). Only needed if a window ever needs the pool
   slot; with WS it is a tidy-up, not a fix.
6. **Jarvis + overlay** windows adopt the channel (they mount the same composables — mostly free
   after 2/3).

## 6. Forks for Kafi / Chad

- **WS (C) vs SSE (B)** — recommendation above; B if the node-server bump misbehaves.
- **Slice 4 now or later** — the count is safe without it (0 HTTP standing + ≤1 own POST per
  window); it is worth doing for correctness of the origin stream, not for the budget.
- **macOS**: verify WKWebView WS behaviour before shipping a Mac build.
- **Remote engine**: confirm the tunnel forwards the bearer on the upgrade.

## 7. Verification recipe (kept from the budget note)

`curl …/health` from the machine (ms = API fine) → DB timeline → DevTools Network → Timing
`Stalled/Queueing` = the pool → count standing sockets per window (`stream`, `events`, `live`).
