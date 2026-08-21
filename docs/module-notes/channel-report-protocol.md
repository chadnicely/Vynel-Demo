# Channel report protocol (Kafi, 2026-08-22) — Option A

**Decision.** Task → report to the REQUESTER → the requester processes it → the requester replies to
the channel. The completion→channel shortcut (`settleCompletedTask` shipping a distilled line to
Telegram 2 ms after completion, distill included) is deleted: it skipped the protocol, so the
requester never learned the task finished and the user got a summary nobody had read.

**1. The delegate always reports.** `ROUTED_TASK_INSTRUCTIONS` gains "no task ends without a report".
Engine net: a completed WORK job whose `reportedAt` is still null gets an AUTO-REPORT synthesized
from its `resultText` and enqueued through the ordinary `enqueueReportDelivery` path (A3c idempotent
inbound row = the delivery job id). Suppressed for notes and when the task CHECKPOINTED (the
continuation returned a follow-up id — the task did not end).

**2. Semantics.** `reportedAt` keeps its ONE meaning: *the running turn reported through the tool*.
The fallback stamps nothing and adds no column — it marks the delivery row's BODY
`(auto-report: the task ended without reporting)`.

**3. The requester answers the channel.** Report-delivery rows may now carry the origin columns
(hard-nulled before). The notify turn is origin-wrapped — global via `runGlobalRootTurn({ origin })`,
workspace via a new `origin` on the delegated-turn MCP composer — so `reply_to_channel` is addressed.
The answer marker rides **provider input only** (`channelReplyMarker` / `providerMarker`); no
`originChannel` row stamp — that row is a report from a child, not a message Telegram sent. The
failure push carries the origin too. A `direct_to_user` on channel work reroutes to a report (the
direct path runs no turn, so nobody would answer). ⚠ The origin also rides delegations the notify
turn enqueues — same as a channel root turn; the chain still terminates at the root.

**4. Failsafe.** ONE home: a report-delivery row that fails TERMINALLY with an origin ships its body
(trimmed to 4096) to the channel. No re-distill — the path fires when the system is already failing.
`summarizeReport` is now unwired everywhere (left in the provider). "Terminally" is EARNED, not
assumed: the fail CAS must win (a row the lease sweeper already handed back belongs to the requeued
attempt, which will answer) and a user STOP settles the row silently. What ships is the SENDER-FACING
half of the body — `extractSenderFacingReport` drops a leading `AUTO_REPORT_MARKER` line and
everything under `REPORT_ASSISTANT_NOTES_MARKER`, so no person reads "Tell the user it failed, and
re-send it with send_message" or a raw `<error>`. Every ENGINE-authored report body — the give-up
push, the orphan sweep's, and the empty auto-report — composes both halves in one home
(`composeReportWithAssistantNotes`); a CHILD's own report is prose for both audiences and needs none.

**4b. The notify turn's zero-reply net.** A notify turn can COMPLETE and still never call
`reply_to_channel` — the requester absorbs the report, writes chat text, and the sender is left with
the interim ack and nothing since. That is the inbound runners' silent-turn shape, so it takes their
net unchanged: `shipSilentChannelTurnFallback` is now the ONE home for both call sites (the model's
final text if any, else the fixed line). Gated on the completion CAS, for the failsafe's reason.

**4c. Correlated windows, not time windows.** "Did this turn reply?" used to be (channel, chat,
enqueuedAt ≥ turnStartedAt). Inbound messages run CONCURRENTLY, so a sibling turn's reply in the same
chat suppressed this turn's line and the sender heard NOTHING. Every reply a turn queues through
`reply_to_channel` now carries a `turnCorrelationId` — the inbound row's id for a channel turn, the
delivery job's id for a notify turn — riding the ambient origin header exactly like
`externalMessageId` (header-only, never a column, job enqueues ignore it) and landing in the outbound
row's `messageStructure` blob. The count still uses the time window; correlation only DISQUALIFIES a
reply provably owned by another turn. An unstamped reply (a proactive `send_to_channel`, a row from
before the field) still counts — a dropped key degrades to today's silence, never to a duplicate.
Group rooms narrow further on `externalRecipientId`.

**5. Silent channel turn (agent B's GAP 3).** NARROWS the 2026-07-27 tool-only rule to "the model's
text is never auto-shipped WHILE it has replied via the tool". A turn ending with zero
`chat-stream-final` rows for its chat context ships one line: its final text, else
`I couldn't do that from here — it needs your OK in the app.` ⚠ Three calls for Kafi, all pinned by
tests: (a) that fixed line assumes blocked/denied — a wordless turn with nothing blocked gets it too;
(b) on the MAIN flow (Telegram → root delegates → root ends without replying) it ships the root's
closing text as an interim ack, and the report answers properly later — two messages, the first
unreviewed model text; (c) §4b puts the SAME line on the notify turn, so a wordless notify turn tells
the sender it "needs your OK in the app" even when nothing was blocked — and on the main flow that
line is the sender's SECOND message after the interim ack.

**6. Workspace channel `ask_user`** gains the global runner's bound + turn-end cleanup from the same
`CHANNEL_ASK_TIMEOUT_MS`. The nudge needs nothing: `consumeAskCreatedEvent` already resolves the
ask's own workspace channel first.
