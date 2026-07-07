import { computed, onUnmounted, ref } from "vue";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { streamChatTurnEvents } from "../chat/chat-turn-stream.js";
import {
  createCommandRecognizer,
  isWebSpeechAvailable,
} from "./speech-recognition.js";
import { createSentenceSpeaker } from "./speech-synthesis.js";
import { createDaemonSpeaker } from "./daemon-speaker.js";
import {
  startVoiceCommandSession,
  type VoiceCommandSession,
  type VoiceCommandSessionView,
  type VoiceTurnEvent,
} from "./voice-command-session.js";

// Binds one browser voice-command session to Vue state for the Jarvis overlay:
// Web Speech STT in, a global `/root/turn` per command, speechSynthesis out.
// A voice utterance is just another origin for the one brain — the same SSE
// stream the chat composer uses, reduced to text deltas + a terminal.

const IDLE_VIEW: VoiceCommandSessionView = {
  state: "ended",
  transcript: "",
  spokenText: "",
};

/** Adapt the chat-turn SSE stream to the session's text-and-terminal events. */
async function* runGlobalVoiceTurn(
  client: VynelClient,
  utterance: string,
  signal: AbortSignal,
): AsyncIterable<VoiceTurnEvent> {
  try {
    for await (const event of streamChatTurnEvents(client, {
      scope: { kind: "global" },
      userMessageText: utterance,
      signal,
    })) {
      if (event.kind === "text-chunk") {
        yield { kind: "text", delta: event.textDelta };
      } else if (event.kind === "session-errored") {
        yield { kind: "failed", message: event.errorMessage };
        return;
      } else if (event.kind === "session-interrupted") {
        yield { kind: "failed", message: "the turn was interrupted" };
        return;
      } else if (event.kind === "turn-stream-ended") {
        yield { kind: "completed" };
        return;
      }
    }
    yield { kind: "completed" };
  } catch (error) {
    if (signal.aborted) return;
    yield {
      kind: "failed",
      message: error instanceof Error ? error.message : "the brain is unreachable",
    };
  }
}

export function useVoiceSession(options: {
  /** Called once a session settles back to silence (idle timeout or end()). */
  onEnded: () => void;
}) {
  const vynel = useVynel();

  const view = ref<VoiceCommandSessionView>(IDLE_VIEW);
  /** A user-actionable failure (mic denied, unsupported browser). */
  const failure = ref<string | null>(null);
  const isActive = computed(() => view.value.state !== "ended");
  const canListen = isWebSpeechAvailable();

  let session: VoiceCommandSession | null = null;

  function start(initialCommand?: string): void {
    if (session !== null) return;
    failure.value = null;
    if (!canListen) {
      failure.value =
        "Voice recognition needs Chrome or Edge — this browser has no Web Speech support.";
      // A start that can't begin still ends: the owner must hear it so a wake
      // handed to a Web-Speech-less browser releases the daemon (else it stays
      // handed-off and deaf until the tab closes).
      options.onEnded();
      return;
    }

    const recognizer = createCommandRecognizer();
    // Kokoro through the daemon when it's up; speechSynthesis per-sentence
    // otherwise — the same voice as the native loop whenever possible.
    const speaker = createDaemonSpeaker(createSentenceSpeaker());
    const started = startVoiceCommandSession(
      {
        captureCommand: (onInterim) => recognizer.capture(onInterim),
        abortCapture: () => recognizer.abort(),
        runBrainTurn: (utterance, signal) =>
          runGlobalVoiceTurn(vynel, utterance, signal),
        speak: (text) => speaker.speak(text),
        cancelSpeech: () => speaker.cancel(),
        onView: (next) => {
          view.value = next;
        },
      },
      initialCommand ? { initialCommand } : {},
    );
    session = started;
    started.done
      .catch((error: unknown) => {
        // The one rejecting path is a denied microphone — show it, don't retry.
        failure.value =
          error instanceof Error ? error.message : "Voice capture failed.";
      })
      .finally(() => {
        if (session === started) session = null;
        options.onEnded();
      });
  }

  function end(): void {
    session?.end();
  }

  onUnmounted(() => {
    session?.end();
  });

  return { view, failure, isActive, canListen, start, end };
}
