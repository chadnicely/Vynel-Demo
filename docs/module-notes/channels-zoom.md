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

Sources: [Zoom WebSockets](https://developers.zoom.us/docs/api/websockets/) ·
[Chatbot API](https://developers.zoom.us/docs/api/chatbot/) ·
[Chatbot events](https://developers.zoom.us/docs/api/chatbot/events/) ·
[OpenClaw Zoom plugin](https://openclawdir.com/plugins/zoom-msea8f) (the working precedent).
