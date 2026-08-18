import { computed, onUnmounted, ref } from "vue";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { streamChatTurnEvents } from "../chat/chat-turn-stream.js";
import {
  createCommandRecognizer,
  isWebSpeechAvailable,
} from "./speech-recognition.js";
import { createSpokenAudioPlayer } from "./spoken-audio-player.js";
import { adaptChatTurnStreamToVoice } from "./voice-turn-adapter.js";
import {
  startVoiceCommandSession,
  type VoiceCommandSession,
  type VoiceCommandSessionView,
  type VoiceTurnEvent,
} from "./voice-command-session.js";

// Binds one browser voice-command session to Vue state for the Jarvis overlay:
// Web Speech STT in, a global `/root/turn` per command on the fast voice model.
// The browser NEVER speaks on its own — voice output follows the brain's `speak`
// calls (with the adapter's no-`speak` gist fallback as the safety net).

// The small, fast model voice turns run on (the light triage tier).
// The voice tier (Kafi 2026-08-19): real model, LOW effort — fast speech,
// 1M window (mirrors the daemon pin in apps/voice run-brain-turn.ts).
const VOICE_MODEL = "claude-sonnet-5";
const VOICE_THINKING_EFFORT = "low";

const IDLE_VIEW: VoiceCommandSessionView = {
  state: "ended",
  transcript: "",
  spokenText: "",
};

/** Run one voice turn against the global root; yields the adapter's events and
 *  maps a transport failure to a 'failed' terminal (unless we aborted it). */
async function* runGlobalVoiceTurn(
  client: VynelClient,
  utterance: string,
  signal: AbortSignal,
): AsyncIterable<VoiceTurnEvent> {
  try {
    yield* adaptChatTurnStreamToVoice(
      streamChatTurnEvents(client, {
        scope: { kind: "global" },
        userMessageText: utterance,
        model: VOICE_MODEL, // the voice tier: sonnet at low effort
        thinkingEffort: VOICE_THINKING_EFFORT,
        voice: true, // reply via the speak tool; text is the on-screen record
        signal,
      }),
    );
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
  const player = createSpokenAudioPlayer();

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
    const started = startVoiceCommandSession(
      {
        captureCommand: (onInterim) => recognizer.capture(onInterim),
        abortCapture: () => recognizer.abort(),
        runBrainTurn: (utterance, signal) =>
          runGlobalVoiceTurn(vynel, utterance, signal),
        playSpoken: (text) => player.play(text),
        cancelSpoken: () => player.cancel(),
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
