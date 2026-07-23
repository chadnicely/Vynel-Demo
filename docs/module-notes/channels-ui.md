# Channels UI + manage arc — module notes

**Chad's ask (2026-07-23):** channels get a real UI pass before more kinds land. Show proper
channel icons, add a way to edit/update a channel (rename, allowed users, enable/disable),
Telegram first, then research a Zoom channel. **Scope rule (Chad's clarification): STRICT
visibility — global channels show ONLY on the global list, workspace channels ONLY in their
workspace.** (Previously a workspace drawer also listed the global ones.)

## Ground (as found)

- Backend was already richer than the UI: `/channels` user-scoped surface has
  enable/disable, allowed-senders CRUD, and history routes — none had UI.
- The ONE missing API piece: no update route; `displayName` was frozen at connect.
- Kind → icon/label mapping duplicated: `ChannelsSection.vue` + `ConnectChannelDialog.vue`
  + `components/chat/channel-presentation.ts` (lucide `Send`/`MessageSquare`, not brand marks).

## Decisions

1. **`channel-catalog.ts` is the one home** for kind → presentation (label, tagline, brand
   mark, connect hint). New kinds (zoom, discord) become a catalog entry + a `ChannelAdapter`.
   `channel-presentation.ts` folds into it and dies.
2. **Brand SVG icons** (`ChannelBrandIcon.vue`): real marks in brand colors (Telegram blue
   paper-plane), not monochrome lucide glyphs.
3. **Strict scope filter** in `ChannelsSection` (Chad's rule above). The scope chip dies with
   it — scope is implicit per view. The old sections test pinning "workspace = own + global"
   is recast (spec changed, not a green-making edit).
4. **`ManageChannelDialog`**: rename + pause/resume + allowed-senders list/add/remove over
   the existing routes. Disconnect stays on the row (arm-to-confirm idiom).
5. **Rename = new `PATCH /channels/:channelId`** (user-scoped only — the UI's surface) over a
   new `renameChannelForUser` core op; co-commits a NEW `channel.renamed` outbox event
   (invariant #5). Not x-mcp exposed (parity untouched).

## As-built (2026-07-23) — reviewed CLEAN, should-fixes folded

Folded: server-side `.trim()` on rename (boundary, not just UI) · `channelStatusPill` moved
into the catalog (one home) · "channel gone" fallback gated on `!isPending` · resume-direction
pill test · stray Vite `vite.config.ts.timestamp-*` artifact deleted.

**Recorded, not built (reviewer nits):** pause pill's accessible name is the action while the
visible text is the state (WCAG 2.5.3 — `aria-pressed` next touch) · `ConnectChannelDialog`
hardcodes `CHANNEL_CATALOG.telegram.connectHint` — needs selected-kind indirection the moment
a second `available: true` kind lands (Zoom) · ManageChannelDialog 366 lines (template weight;
within SFC house tolerance) · consider `vite.config.ts.timestamp-*` in `.gitignore` (left
untouched — the file has Chad's uncommitted `.notes/` edit) · repo `updateChannel` bare-Error
race (kernel-wide pattern, only worth an `InvariantError` sweep).

## Zoom (research next, no code yet)

Telegram fits because the inbound pipeline is `pollForInboundMessages` (long-poll). Zoom
chatbots are webhook-push (public URL — hostile to a local desktop app); Zoom's WebSocket
event delivery may be the fit. Findings land in `docs/module-notes/channels-zoom.md`.
