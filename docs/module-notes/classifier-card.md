# Classifier-deny re-authorize card (2026-08-20)

Kafi's call (2026-08-19) after a teammate's ssh `crontab` write died with a card that only said "failed". Branch
`feature/classifier-card` (worktree `.claude/worktrees/session-audit`, band 18940).

## Problem

Vynel `auto` = the SDK's `auto` mode; Vynel never cards in auto, but the SDK's OWN classifier can deny a
call outright (`soft_deny`: destructive/irreversible without clear user intent) BEFORE `canUseTool` — the
model gets the canned tool_result ("The user doesn't want to take this action right now. STOP…") and stops.
The SDK announces it as `system`/`permission_denied` (`tool_name`, `tool_use_id`, `decision_reason_type?`,
`decision_reason?` — may carry ANSI — `message`); we dropped it, so the row settled `failed` with the cryptic
line. A deny cannot be un-denied in flight, so the card must RE-ISSUE the intent.

## Decision

- One new normalized event `tool-use-blocked` (closed-union ritual: union · live translator · consumer · tests);
  the replay translator is untouched (the JSONL never persists the advisory; the DB row is the durable truth).
- `ToolCallStatus` gains `'blocked'` (free-text column, no migration). Row settles `status:'blocked'`,
  `toolOutput: { blockedBy, reason, message }`, `isErrorResult:true`. The canned error tool_result that follows
  never flips it (the `wasDenied` guard's twin); arriving FIRST, the event still flips the row.
- NO new wire kind: the settle rides the existing `tool-call-completed` frame (the row carries `status`), and
  every stream/live/watch writer is generic (`event: event.kind`) — the consumer's yield IS the one mapping
  home. `SessionTurnStepStatus` mirrors the vocabulary (the feed's `turn-tool-settled`).
- Re-authorize = a NORMAL user message on the same session: `Approved — go ahead and run <toolName> exactly as
  proposed.` Card emits → list → thread → the owner view sends through its own composer (`AppComposer.sendText`,
  exposed; settings resolution keeps ONE home). Disabled while a turn streams, hidden after the click.
- Shared shape + text: `@vynel/contracts/chat/blocked-tool-call.ts` (writer = chat consumer; readers = card + owner).

## Shape

providers: `shared/normalized-session-event.ts` (+variant) · `claude/base/translate-claude-system-message.ts`
(new: `system/permission_denied` → event, ANSI stripped; dispatched from `translate-claude-sdk-event.ts`) · tests.
chat: `schema/chat-tool-calls.ts` (+'blocked') · `turn-consumption/handle-tool-use-blocked.ts` (new; the audit
warn lives here) · `consume-session-event-stream.ts` (case + the completed guard) · consumer tests.
contracts: `chat/chat-http.ts` · `chat/session-activity.ts` · `chat/blocked-tool-call.ts` (+test).
local-api: `routes/chat/schemas.ts` enum (+regenerated `packages/sdk` artifacts) · chat-turn SSE frame test.
ui: `ToolCallCard.vue` (blocked line + "Run it anyway") · `ToolCallList.vue` (pass-through) · presenter · tests.
local-web: `ThreadStream.vue` · `LiveTurn.vue` · `AppComposer.vue` (`sendText`) · `use-reauthorize-tool-call.ts`
(the owners' ONE handler) · the five thread owners · desktop fold/overlay (+'blocked') · sessions-view owner test.

## Review fold (2026-08-20)

- View-only threads (library opens, earlier chain parts, the monitor's pane — `chattable:false`, no
  composer) offered an enabled "Run it anyway" that went nowhere. `ThreadStream` now takes
  `reauthorizable` (default true; `SessionThreadView` passes `chattable`) and computes ONE
  `ReauthorizeState` (`ready | streaming | view-only`, exported by `@vynel/ui`) for settled cards and
  the live turn alike; the card's disabled title names the reason.
- `SDKPermissionDeniedMessage` attributes a subagent by `agent_id`, never `parent_tool_use_id` — the
  event carries `agentId`; the handler audits every block once and settles only a main-thread row.
- The presenter unwraps the refusal record only on `status:'blocked'` — a lookalike output stays raw.
