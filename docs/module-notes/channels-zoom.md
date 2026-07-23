# Zoom channel — research notes (2026-07-23, no code yet)

**Chad's ask:** after the Telegram UI pass, check what a Zoom channel integration looks like.

## Verdict: FEASIBLE for a local desktop app — via Zoom Team Chat bot + WebSocket events

The blocker we feared (Zoom chatbots are webhook-push, needing a public URL) has a first-party
answer: **Zoom WebSocket event delivery**. A Marketplace Team Chat app can subscribe to its
events in *WebSocket mode* and receive them over an outbound `wss://ws.zoom.us/ws?subscriptionId=…&access_token=…`
connection — no inbound port, no ngrok, works behind NAT. An existing local-first AI-assistant
plugin (OpenClaw's Zoom plugin) ships exactly this shape in production: `bot_notification`
events arriving over the socket, tokens refreshed proactively (~55 min), 30-second heartbeat.

## The shape

- **App**: a (private) Team Chat app on marketplace.zoom.us, `imchat:bot` scope.
  Credentials: **clientId + clientSecret + botJid + accountId + subscriptionId** — all strings,
  fits our opaque `BotCredentials` bag as-is.
- **Auth**: `client_credentials` grant → Bearer token (also authenticates the socket URL).
  `verifyCredentials` = a successful token grant.
- **Inbound**: `bot_notification` (bot DM / slash command), `team_chat.app_mention`,
  `interactive_message_actions` (button clicks — future approval cards). Payload carries
  sender (`operator`/`operator_id`), `toJid` (chat context), message id + content — maps
  cleanly onto `NormalizedInboundMessage`.
- **Outbound**: `POST /v2/im/chat/messages` (bot token) — markdown (`is_markdown_support`),
  **edit** (`PUT /im/chat/messages/{id}`), delete, reply threading, interactive buttons.
  So: `supportsMessageEditing` TRUE (streaming-look possible), `supportsInlineButtons` TRUE,
  `supportsTypingIndicator` FALSE (no such API).

## Fitting the ChannelAdapter contract (the fork to settle at build time)

Our pipeline is pull (`pollForInboundMessages(sinceCursor)` on the 5s tick); Zoom is
push-over-socket. **Recommended: the adapter owns the socket and buffers.**
`ZoomChannelAdapter` holds a persistent connection per connected channel (a genuinely
stateful service — class is house-legal), folds inbound events into an in-memory buffer,
and `pollForInboundMessages` drains the buffer each tick. Zero pipeline changes; cursor
becomes vestigial (Zoom does not replay). Latency ≤ one tick. The alternative — adding a
push path to the adapter contract — touches every consumer for one kind's benefit; not worth
it at v1.

## Known limits / verify-at-build

- **No replay**: events during a socket disconnect are LOST (Zoom doc is explicit). Reconnect
  + heartbeat discipline is the mitigation; a missed message shows nothing rather than
  arriving late. Acceptable v1; record in the adapter.
- Verify: every message in the bot's 1:1 DM arrives as `bot_notification` without a slash
  command (expected; confirm on a real app).
- Verify: Marketplace app creation rights on Chad's Zoom account (admin needed on some plans).
- Rate limit label MEDIUM on send — fine for our volumes.

## Prerequisites in OUR codebase (from the channels-ui pass)

- `ChannelKind` union grows `'zoom'` (schema `$type`, contracts, route zod enums, catalog).
- `ConnectChannelDialog` needs selected-kind indirection + per-kind credential FIELDS (the
  recorded nit: today it hardcodes telegram's single-token form; Zoom needs 5 fields).
- Catalog entry + `ChannelBrandIcon` mark for zoom — one entry + one SVG path, by design.

## As-built (2026-07-23)

- **`ZoomChannelAdapter`** (`adapters/zoom/`): the recommended stateful shape — one
  `ZoomEventSocket` per connected channel (25s heartbeat, buffered `bot_notification`
  normalization, defensive frame parsing that never throws into the process), drained by
  `pollForInboundMessages`; dead sockets recreated on the next tick; idle connections (unpolled
  60s — disabled/disconnected channels) reaped; send/edit over the Chatbot Messages API with a
  per-app cached token (no grant-per-message). Network boundary injectable (fetch + socket
  factory) — tested without mocks of modules.
- Capabilities: editing YES (streaming-look possible later) · buttons NO v1 (approval cards
  degrade to typed approve/deny — `enqueueApprovalRequest` gates on `supportsInlineButtons`) ·
  typing NO (no such API).
- Group model rides the groups arc as-is: `toJid` on `@conference.` = group (title =
  `channelName`); every `bot_notification` is inherently addressed → `isBotMentioned` true.
  DM `toJid == userJid` keeps the `scopeContextId == senderId` allowlist assumption.
- `'zoom'` threaded through EVERY kind/origin union (schema `$type`, contracts, route enums,
  `SessionTurnOrigin`, `ReportDeliveryTarget` + its format rule, MessageRow badge, GlobalChatView
  label). The exhaustive-map guards caught two sites at typecheck — the design working.
- Connect dialog is now fully catalog-driven: per-kind credential FIELDS (`credentialFields` +
  `allowedSenderField` on the catalog entry — the recorded telegram-hardcode nit CLOSED). Zoom
  entry = 5 fields; no initial-sender field (JIDs aren't user-knowable — senders are added from
  Manage after their first message shows up ignored).
- New dep: `ws` (+`@types/ws`) in `@vynel/channels`.

### Review folds (2026-07-23, reviewed CLEAN 0 must-fix)

Folded: **CONNECTING grace** (a handshaking socket within 30s counts alive — tearing it down
each 5s tick would loop token grants forever; stuck handshakes recycle past the window; pinned
by a readyState-0 test) · **self-scheduled reap timer** (unref'd; the LAST channel's socket no
longer lives until process exit when polling stops — timer clears when the map empties;
fake-timer test) · buffer capped at 500 oldest-drop · accountId cross-check in normalization ·
cursor-pointer on selectable kind cards.

RECORDED (nits, not built): empty `message_id` from a successful send is kept (throwing would
re-send a DELIVERED message — duplicate > missing id; bites only editMessage later) ·
credential rotation staleness (socket identity + send-token cache refresh on expiry/reap, not
on rotation) · same-millisecond synthetic-id collision (unreachable in practice) · the ws
double-cast at the factory seam · edits render markdown literally (matches telegram edit).

### Fix round 3 (2026-07-24, Chad's connect attempt): the chatbot token carries NO `aid`

Chad's real token granted fine but decoded to no account id (client_credentials chatbot
tokens are app-level) — round 2's claim-decode alone wasn't enough. **The account id is now
never fatal at connect: every `bot_notification` payload carries `accountId`, so the socket
LEARNS it from the first frame** (`onAccountIdLearned` → adapter's per-clientId
`learnedAccountIds`) and the resolution chain is typed override → learned → token claim.
Verify succeeds with a null id; only a SEND before any inbound throws (actionable message).
The cross-account frame check activates once the id is known. In-memory only — after a
restart the first inbound re-teaches (inbound precedes replies; the queue's backoff covers
the rare proactive-send-first race). Field stays optional in the connect form as an override.

### Fix round 2 (2026-07-23, Chad's setup): Account ID auto-detected

**Chad couldn't find the Account ID anywhere in Zoom's console (it barely surfaces it). Root
fix: nobody should have to.** Zoom access tokens are JWTs whose payload carries the account id
as the `aid` claim — `fetchZoomAccessToken` now decodes it (best-effort, never throws), the
adapter's `resolveAccountId` prefers a typed value and falls back to the claim, and an
underivable id fails verify with an actionable message. `accountId` dropped from the REQUIRED
credential keys; the socket entry is now created AFTER the first token grant (identity needs
the resolved id). Catalog: the field is last, optional, labeled auto-detected; the connect
dialog omits empty optional fields from the bag (`optional` on ChannelCredentialField).

### PARKED (Chad, 2026-07-24) — wire-verified: no bot events over WS on his account

Live debugging with a sole-listener wire probe (the app's channel paused — **Zoom allows ONE
consumer per subscription id**; a second connect kicks the first with "Connected in another
place") established, empirically:
- Token grant + WebSocket + `build_connection` all work; the chatbot token's claims are
  `{aud, uid, ver, auid, nbf, iss, gno, exp, type:2, iat}` — **no `aid`** (fix round 3's
  learn-from-notification design confirmed necessary).
- **The Event Types catalog on Chad's account does NOT offer `bot_notification`** (searching
  "bot" yields only Team Chat Channel Chatbot Added/Removed membership events). 32 account
  chat events (Chat Message ×4 + Team Chat ×28) subscribed → messaging produced ZERO frames.
- Remaining unknown: the app's Local Test/authorization state (was "Not ready"); an
  unauthorized app emits nothing regardless. Chad chose to park rather than continue
  console archaeology.

**Decision: catalog `zoom.available = false` ("Coming soon") — ONE flag. Adapter, unions,
routes, tests, learn-account-id machinery all stay live and green. His connected Zoom channel
row remains, PAUSED (disabled via API during probing). To resume: authorize the app (Local
Test → Add), re-probe for the actual event name, adapt `zoom-event-socket` if it's a
`chat_message.*` shape, flip the flag.**

### Recorded follow-ups (zoom)

- Interactive messages (buttons) + `interactive_message_actions` → approval cards with taps.
- `team_chat.app_mention` subscription → responding to @mentions in channels the bot wasn't
  slash-invoked in (needs the event added to the Marketplace subscription).
- Surface recently-ignored senders in Manage for one-tap allow (Zoom onboarding depends on it
  more than Telegram — JIDs are opaque).
- Verify on Chad's real account: bot_notification `messageId` presence, exact `Expire_in`
  casing in the token response (we read `expires_in`, fall back 3600s), and whether the WS
  frame's `content` arrives as string or object (both handled).

Sources: [Zoom WebSockets](https://developers.zoom.us/docs/api/websockets/) ·
[Chatbot API](https://developers.zoom.us/docs/api/chatbot/) ·
[Chatbot events](https://developers.zoom.us/docs/api/chatbot/events/) ·
[OpenClaw Zoom plugin](https://openclawdir.com/plugins/zoom-msea8f) (the working precedent).
