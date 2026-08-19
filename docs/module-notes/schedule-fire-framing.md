# Schedule-fire framing — a fired prompt is the scheduler speaking, not the user (2026-08-20)

Kafi's live bug: global schedule "Tea" ("Remind me for tea") fired as **You · Remind me for tea**;
Claude called the native `AskUserQuestion` (unanswerable in Vynel — self-answered empty in 14 ms)
and then `sleep 900` to "set a timer". Branch `feature/schedule-fire-framing`.

## A — one frame, both fire paths

- New instruction `packages/instructions/session-instructions/schedule-fire-marker.md` (one line,
  the voice-turn-marker shape) with `{{scheduleName}}` / `{{firedAtLocal}}`; rendered by a new
  `renderScheduleFireMarker` beside the loader. Substance: this is the scheduler firing "<name>"
  now (<local time>), NOT the user typing; a reminder/message is delivered NOW — never a timer,
  never sleep, never ask what they meant; otherwise do the work and report briefly.
- The LEAF decides (`fire-schedule.ts` composes ONE `frame { marker, sourceLabel }` per fire):
  the schedules leaf cannot import `@vynel/instructions` (sibling leaf, invariant #2), so the
  renderer is INJECTED as `FireScheduleDeps.renderScheduleFireMarker`, bound api-side in
  `build-schedule-fire-deps.ts`. Local time = the leaf's own `formatScheduledTime` (exported).
- `sourceLabel` = `Schedule · <name>` — the standing system-notice convention
  (`consume-schedule-run-failed-event.ts`); extracted to `@vynel/contracts` (`scheduleSourceLabel`)
  and used by both homes. `MessageRow` already renders `sourceKind:'system'` + label as the quiet
  bell notice — no new chrome.
- GLOBAL path: persisted row = plain rendered prompt, `inboundAttribution { sourceKind:'system',
  sourceLabel }`; the model reads it via the marker seam (`channelReplyMarker`). New
  `RunGlobalRootTurnInput.autoContinue` override: attribution alone must not demote a fire to a
  delivery turn — a fired schedule IS work (keeps nudge + auto-continue).
- WORKSPACE path: `providerUserMessageText` = prompt + marker; `messageAttribution`
  system + label; persisted body stays the plain prompt (seams already in `startChatTurn`).

## B — `AskUserQuestion` has no Vynel answer channel

`build-claude-sdk-options.ts` always disallows it (`NATIVE_TOOLS_WITHOUT_A_VYNEL_ANSWER_CHANNEL`,
unioned + deduped with caller denials); Vynel's question channel stays `mcp__vynel-ask__ask_user`.
