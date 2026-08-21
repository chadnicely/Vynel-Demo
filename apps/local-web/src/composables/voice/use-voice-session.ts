import { computed, onUnmounted, ref } from "vue";
import type { VynelClient } from "@vynel/sdk";
// The voice tier — ONE home in contracts (daemon, overlay, panel defaults).
import {
  VOICE_TIER_MODEL as VOICE_MODEL,
  VOICE_TIER_MODE as VOICE_MODE,
  VOICE_TIER_THINKING_EFFORT as VOICE_THINKING_EFFORT,
} from "@vynel/contracts/chat/voice-tier";
import { useVynel } from "../use-vynel.js";
import { streamChatTurnEvents } from "../chat/chat-turn-stream.js";
import {
  createCommandRecognizer,
  isWebSpeechAvailable,
} from "./speech-recognition.js";
import { createSpokenAudioPlayer } from "./spoken-audio-player.js";
import { adaptChatTurnStreamToVoice } from "./voice-turn-adapter.js";
import { startVoiceCommandSession } from "./voice-command-session.js";
import type {
  VoiceCommandSession,
  VoiceCommandSessionView,
  VoiceTurnEvent,
} from "./voice-command-session-types.js";

// Binds one browser voice-command session to Vue state for the voice overlay:
// Web Speech STT in, a voice-thread `/root/turn` per utterance on the voice
// tier, the reply's streamed text spoken in the browser sentence by sentence,
// and a barge-in that stops the server turn by its own id.

const IDLE_VIEW: VoiceCommandSessionView = {
  state: "ended",
  transcript: "",
  spokenText: "",
  notice: "",
};

/** Run one voice turn against the spoken thread; yields the adapter's events
 *  and maps a transport failure to a 'failed' terminal (unless we aborted it). */
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
        // The voice tier on EVERY leg (D2): sonnet at low effort, hands-free.
        // The mode matters most — a spoken turn that stops on an approval card
        // is a turn nobody can answer.
        model: VOICE_MODEL,
        thinkingEffort: VOICE_THINKING_EFFORT,
        mode: VOICE_MODE,
        voice: true, // the spoken thread — its streamed text is its voice
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

  /** `turnWatchdogMs` is the daemon's silence bound carried on a wake; a
   *  manual (mic-button) start has none and the session uses its default. */
  function start(initialCommand?: string, turnWatchdogMs?: number): void {
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
        // Identity-shaped: the spoken thread's own segment, never the global head.
        interruptTurn: async (sessionId) => {
          await vynel.root.interruptTurn({ sessionId });
        },
        onView: (next) => {
          view.value = next;
        },
        // Spoken as an apology; the cause lands on the overlay's failure line (the
        // web app has no logger seam and the house rule bans console output) so a
        // turn that keeps breaking is readable where it happened.
        onTurnError: (error) => {
          failure.value = `The voice turn broke: ${error instanceof Error ? error.message : String(error)}`;
        },
      },
      {
        ...(initialCommand ? { initialCommand } : {}),
        ...(turnWatchdogMs !== undefined ? { turnWatchdogMs } : {}),
      },
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

  /** The chat session our turn in flight runs on — null between turns and
   *  when no session is live. The daemon link uses it to tell a relayed copy
   *  of OUR OWN voice from another producer's line. */
  function currentSessionId(): string | null {
    return session?.currentSessionId ?? null;
  }

  /** Play another producer's line (a relayed `speak`) through the live
   *  session's own player + echo filter while a turn is in flight — false when
   *  there is none to take it, and the caller plays it on its own player. */
  function speakExternal(text: string): boolean {
    return session?.speakExternal(text) ?? false;
  }

  onUnmounted(() => {
    session?.end();
  });

  return { view, failure, isActive, canListen, start, end, currentSessionId, speakExternal };
}
