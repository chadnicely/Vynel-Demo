# Channel groups — module notes

**Chad's ask (2026-07-23, after smoking the channels UI pass):** channels get GROUP support —
Telegram groups now, shaped so Zoom group chat (channels) rides the same model.

## Locked decisions (Chad, 2026-07-23)

1. **Group access = per-group toggle**: an approved group has `memberPolicy`
   `'everyone'` (default — approving the room trusts the room) or `'allowlist'` (member must
   ALSO be an allowed sender scoped to that group — the existing exact-match
   `(sender, scopeContextId=groupContextId)` mechanics, zero schema change).
2. **Reply trigger = @mention only** for now; a per-group "respond to every message" toggle is
   a RECORDED follow-up (it additionally requires the user to disable Telegram bot privacy
   mode via BotFather — teach it when we build it).
3. **Approvals NEVER post into groups**: a group-origin turn's approval card stays in the app
   (web notifier); any room member could tap a button posted into the room. DM behavior
   unchanged.

## Ground (as found)

- The Telegram adapter already normalizes group messages (chat.id ≠ from.id, both captured);
  the reply path already targets `externalChatContextId` so group replies Just Work.
- The block is the polling tick's allowlist check: exact match on
  `(channelId, senderId, scopeContextId)` where DM rows default `scopeContextId = senderId`
  (DM chat id == sender id). A group message carries the GROUP's chat id as scope → no row →
  `ignored`. Deliberate Phase-1.5 gate (schema comment says so).
- Telegram privacy mode (default ON) means a group bot only RECEIVES @mentions, /commands,
  and replies-to-its-messages — which aligns exactly with decision 2.
- `channel_inbound_messages` does NOT store sender handle/name — group attribution rides the
  opaque `messageMetadata` JSON (no schema change).

## The design

**New table `channel_chat_groups`** — one row per group context the bot has seen:
`(channelId FK-cascade, externalChatContextId, title, status pending|approved|ignored,
memberPolicy everyone|allowlist, firstSeenAt, lastInboundAt, approvedAt)`, UNIQUE
`(channelId, externalChatContextId)`. Discovery over configuration: **add the bot to a group,
@mention it once → a `pending` row appears in the Manage dialog → Approve.** Nobody pastes a
`-100…` chat id.

**Adapter contract grows group awareness** (`NormalizedInboundMessage`): `chatContextKind`
`'dm'|'group'`, `chatContextTitle`, `isBotMentioned` (DMs: always true). Telegram derives
them from `chat.type`/`chat.title`, mention entities matching the bot handle, and
reply-to-bot (`reply_to_message.from.id` == bot id); the poll input gains optional
`botIdentity {externalId, handle}` (from the channel's stored `botMetadata`). Zoom later:
channel JID vs user JID + `team_chat.app_mention` — same fields, no pipeline change.

**Polling tick, group path**: unknown group → insert `pending` row + the triggering message is
NOT enqueued (recorded as nothing; the group card is the visible outcome). Pending/ignored
group → skip messages entirely (no per-message rows — a busy room must not flood the audit
table). Approved group → only `isBotMentioned` messages become inbound rows (decision 2);
policy `'everyone'` → allowed, `'allowlist'` → the existing `findAllowedSender` with
`scopeContextId = group context id` (miss → stored `ignored`, the DM-consistent audit row).
Group `lastInboundAt`/title refresh on sight.

**Routing (slice ②)**: group-origin turns prepend a speaker line (sender display name + group
title, from messageMetadata) so the model AND the transcript know who in the room asked;
`onApprovalRequested` skips the channel push for group contexts (decision 3, logged); replies
thread as reply-to the triggering message in groups.

**UI/routes (slice ③)**: ManageChannelDialog gains a Groups block (pending → Approve/Ignore;
approved → policy toggle + revoke); user-scoped routes
`GET /channels/:id/groups` · `POST …/groups/:groupId/approve` · `POST …/groups/:groupId/ignore`
· `PATCH …/groups/:groupId` (memberPolicy). Group state changes co-commit
`channel.group-status-changed` / `channel.group-policy-changed` outbox events (invariant #5).
Discovery hint copy in the dialog.

## Slices

① schema + migration 0018 + repo + adapter group fields + polling-tick discovery/gating
② turn routing: attribution + approval suppression + threaded group replies
③ routes + Manage-dialog Groups block + composables
Each: gate green → review → fold → commit.

## As-built (2026-07-23) — reviewed CLEAN, should-fixes folded

Folded: discovery insert rides `insertChannelChatGroupIfAbsent` (`onConflictDoNothing` — an
overlapping tick's lost race degrades to "already recorded", never a `network-error`-mislabeled
channel) · group liveness only moves FORWARD (out-of-order redelivery can't rewind
`lastInboundAt`) · ChannelGroupsBlock surfaces mutation errors + re-syncs the policy select on
failure (render-key bump) + `isPending` guard on policy change · the 4 group routes joined the
route-level tenant-isolation 404 sweep.

## Recorded follow-ups

- Per-group "respond to all messages" toggle (+ BotFather privacy-mode teaching copy).
- DM-the-sender approval fallback for group-origin turns (v2 of decision 3).
- Mention stripping from `messageBody` (v1 passes the raw text; the model sees "@bot …").
- **Group `/command@bot` messages carry a `bot_command` entity, not `mention`** — Telegram
  delivers them under privacy mode as explicitly addressed, but the mention gate skips them.
  Fold into `isBotAddressed` when channel commands ship.
- Re-approving an already-approved group re-stamps `approvedAt` + re-emits the event (API-level
  idempotency noise; the UI hides the button).
- The polling `setInterval` has NO in-flight guard (channels-service) — overlapping ticks are
  the root cause the if-absent insert nets. Sweep as its own slice.
- `user-scoped.ts` is 482 lines (Hono single-chain constraint; longest offender — split if the
  chain ever allows).
- Zoom adapter arc consumes this model as-is (docs/module-notes/channels-zoom.md).
