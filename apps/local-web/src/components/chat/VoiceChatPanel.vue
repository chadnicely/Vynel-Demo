<script setup lang="ts">
import { computed, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { PresenceDot, ThreadSkeleton, EmptyState } from "@vynel/ui";
import ThreadStream from "./ThreadStream.vue";
import AppComposer from "./AppComposer.vue";
import QueuedMessageChips from "./QueuedMessageChips.vue";
import { useOpenPointerTarget } from "./open-pointer-target.js";
import { useVynel } from "../../composables/use-vynel.js";
import { sessionKeys } from "../../composables/chat/session-keys.js";
import { useChatTurn } from "../../composables/chat/use-chat-turn.js";
import { useWatchedTurn } from "../../composables/chat/use-watched-turn.js";
import { matchTurnToIdentity } from "../../composables/activity/match-turn-to-identity.js";
import { useQueuedSend } from "../../composables/chat/use-queued-send.js";
import { useDecideApproval } from "../../composables/approvals/use-decide-approval.js";
import { useActivityStore } from "../../stores/activity-store.js";
import type { TurnAttachmentInput } from "../../composables/chat/turn-attachments.js";
import type { ComposerSettings } from "../../composables/chat/use-session-settings.js";
import { formatSdkError } from "../../utils/format-sdk-error.js";
import {
  VOICE_TIER_MODEL,
  VOICE_TIER_MODE,
  VOICE_TIER_THINKING_EFFORT,
} from "@vynel/contracts/chat/voice-tier";

// The Voice chat panel (voice-session arc) — the spoken thread's window,
// rendered on the Global canvas under its own menu row. The thread is the
// SPOKEN TWIN: its transcript comes through the voice UI doors (the tool
// surface stays walled), a typed message runs a real voice turn (`voice:
// true` — the reply speaks aloud when the daemon is up, and always lands
// here as text), and a turn the daemon started streams in live through the
// same session watch every thread uses.
const ASSISTANT_NAME = "Claude";

// The spoken thread runs the VOICE TIER on every leg (session-hardening D2):
// the same model, effort and hands-free mode whether the words are spoken or
// typed here. The server forces it for `voice` turns regardless of what a
// caller sends, so the composer shows it read-only and the send carries it
// literally — this thread never reads or writes a settings row.
const VOICE_TURN_SETTINGS: ComposerSettings = {
  modelId: VOICE_TIER_MODEL,
  mode: VOICE_TIER_MODE,
  thinkingEffort: VOICE_TIER_THINKING_EFFORT,
  autoBuildout: false,
};
const HANDS_FREE_NOTE =
  "Hands-free — the voice thread always runs on its own tier, so these settings can’t be changed here.";

const vynel = useVynel();
const activity = useActivityStore();

// A voice turn announces on the feed with its OWN scope (`voice`) — that
// signal keeps the transcript polling while the daemon drives a turn this
// panel does not own. It used to announce as `global` with `origin: 'voice'`,
// which made every reader infer identity from an absence; scope is now the
// only thing this predicate reads.
// ONE liveness predicate for every reader (D1) — never a private re-derivation.
const hasVoiceServerTurn = computed(() =>
  Object.values(activity.serverTurns).some((serverTurn) =>
    matchTurnToIdentity(serverTurn, { kind: "voice" }),
  ),
);

const transcriptQuery = useQuery({
  // Under sessionKeys.all so every turn-end invalidation refetches it (the
  // same freshness contract the other threads ride).
  queryKey: [...sessionKeys.all, "voice-transcript"],
  queryFn: () => vynel.root.getVoiceTranscript(),
  // A plain function, NEVER a computed: vue-query unwraps computed options
  // eagerly during setup, and this getter reads `watchedTurn` — declared
  // below — so a mid-turn mount died in its temporal dead zone (reviewer
  // repro). query-core invokes a function option after setup.
  refetchInterval: () =>
    hasVoiceServerTurn.value && !watchedTurn.hasSharedFold.value ? 4000 : false,
});
const messages = computed(() => transcriptQuery.data.value?.messages ?? []);
const sessionModel = computed(
  () => transcriptQuery.data.value?.session?.model ?? null,
);
const toolCallsByMessageId = computed(
  () => transcriptQuery.data.value?.toolCallsByMessageId ?? {},
);
/** The spoken thread's CURRENT segment — the watch key and the composer's
 *  settings identity. Null until something was ever spoken or typed here. */
const headSessionId = computed(
  () => transcriptQuery.data.value?.session?.id ?? null,
);

// A typed message IS a voice turn (voice: true): it runs on the spoken twin
// conversation under the speak steering — the reply is spoken aloud when the
// daemon is up, and streams here as text either way.
const turn = useChatTurn({
  scope: () => ({ kind: "global" }) as const,
  voice: true,
  detachWhen: () => watchedTurn.hasSharedFold.value,
});

// The standing watch on the spoken thread's live channel — a turn the DAEMON
// started (the wake word) streams here in realtime, exactly like any other
// thread's background turn.
const watchedTurn = useWatchedTurn({
  sessionId: () => headSessionId.value,
  isSuppressed: () => turn.view.value !== null,
  refetchDetail: async () => {
    const result = await transcriptQuery.refetch();
    if (result.error) throw result.error;
    return result.data ?? undefined;
  },
});

const activeTurn = computed(() => turn.view.value ?? watchedTurn.view.value);
const turnErrorText = computed(
  () => turn.errorText.value ?? watchedTurn.lastTurnErrorText.value,
);

// A watched turn's settle lands its rows here without waiting on the
// app-wide invalidation (the SessionThreadView contract).
watch(
  () => watchedTurn.view.value,
  (next, previous) => {
    if (previous !== null && next === null) void transcriptQuery.refetch();
  },
);

const openPointerTarget = useOpenPointerTarget();
const decideApproval = useDecideApproval();
function onDecideApproval(
  approvalRequestId: string,
  decision: "approved" | "denied",
) {
  decideApproval.mutate(
    decision === "approved"
      ? { providerApprovalId: approvalRequestId, kind: "approved" }
      : {
          providerApprovalId: approvalRequestId,
          kind: "denied",
          reason: "Denied from chat.",
        },
  );
}

function sendMessage(text: string, attachments: TurnAttachmentInput[]) {
  void turn.startTurn({
    sessionId: headSessionId.value,
    isContinuous: true,
    userText: text,
    // The composer's emitted settings are deliberately ignored: they are the
    // read-only tier already, and sending the constant keeps this leg honest
    // even if a future default drifts underneath the chips.
    settings: VOICE_TURN_SETTINGS,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}
const queuedSend = useQueuedSend(activeTurn, sendMessage);

const isEmpty = computed(
  () =>
    messages.value.length === 0 &&
    activeTurn.value === null &&
    !hasVoiceServerTurn.value,
);
</script>

<template>
  <div class="voice-chat-panel">
    <div class="thread-body">
      <ThreadSkeleton
        v-if="transcriptQuery.isPending.value"
        class="thread-skeleton-pad"
      />
      <p v-else-if="transcriptQuery.isError.value" class="state-note is-error">
        {{ formatSdkError(transcriptQuery.error.value) }}
      </p>
      <EmptyState
        v-else-if="isEmpty"
        title="Nothing spoken yet"
        note="Wake the assistant by voice, or type below — replies are spoken aloud while the voice daemon is running, and always land here."
      />
      <ThreadStream
        v-else
        class="thread-slot"
        :messages="messages"
        :tool-calls-by-message-id="toolCallsByMessageId"
        :active-turn="activeTurn"
        :assistant-name="ASSISTANT_NAME"
        :session-model="sessionModel"
        @decide-approval="onDecideApproval"
        @open-pointer="openPointerTarget"
      />
    </div>

    <p
      v-if="watchedTurn.errorText.value"
      class="view-only-note is-drop"
      data-testid="voice-live-drop-note"
    >
      Live updates dropped — reconnecting; new replies land in the transcript.
    </p>
    <p v-if="turnErrorText" class="turn-error-note">
      {{ turnErrorText }}
    </p>

    <footer class="composer-dock">
      <QueuedMessageChips
        :queued="queuedSend.queued.value"
        @remove="queuedSend.removeQueued"
      />
      <p v-if="turn.isQueuedBehindTask.value" class="queued-note">
        <PresenceDot state="live" />
        Working — your message is queued.
      </p>
      <!-- NO session-id on purpose: with one, the composer would GET and PATCH
           the voice row's settings — a row no voice turn ever reads. -->
      <AppComposer
        :settings-defaults="VOICE_TURN_SETTINGS"
        settings-locked
        :settings-locked-note="HANDS_FREE_NOTE"
        :streaming="turn.isStreaming.value"
        placeholder="Message the voice thread…"
        destination-label="Voice"
        @send="queuedSend.submit"
        @interrupt="turn.interrupt"
      />
    </footer>
  </div>
</template>

<style scoped>
.voice-chat-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.thread-body {
  flex: 1;
  min-height: 0;
}
.thread-slot {
  height: 100%;
}
.thread-skeleton-pad {
  padding: 24px;
}
.state-note {
  padding: 24px;
  color: var(--text-muted, #8a8f98);
}
.state-note.is-error {
  color: var(--status-danger, #e5484d);
}
.view-only-note,
.queued-note,
.turn-error-note {
  margin: 0;
  padding: 4px 16px;
  font-size: 12px;
  color: var(--text-muted, #8a8f98);
}
.turn-error-note {
  color: var(--status-danger, #e5484d);
}
.composer-dock {
  padding: 8px 12px 12px;
}
</style>
