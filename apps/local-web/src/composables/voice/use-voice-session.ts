import { computed, onScopeDispose, ref } from "vue";
import type { VynelClient } from "@vynel/sdk";
// The voice tier — ONE home in contracts (daemon, overlay, panel defaults).
import {
  VOICE_TIER_MODEL as VOICE_MODEL,
  VOICE_TIER_MODE as VOICE_MODE,
  VOICE_TIER_THINKING_EFFORT as VOICE_THINKING_EFFORT,
} from "@vynel/contracts/chat/voice-tier";
import { useVynel } from "../use-vynel.js";
import { streamChatTurnEvents } from "../chat/chat-turn-stream.js";
import type { ChatTurnEvent } from "@vynel/contracts/chat/chat-http";
import {
  createCommandRecognizer,
  isWebSpeechAvailable,
} from "./speech-recognition.js";
import { createCloudCommandRecognizer } from "./cloud-command-recognizer.js";
import { useUserPreferences } from "../users/use-user-preferences.js";
import { createInputDeviceResolver } from "./input-device-binding.js";
import { createSpokenAudioPlayer } from "./spoken-audio-player.js";
import { adaptChatTurnStreamToVoice } from "./voice-turn-adapter.js";
import { voiceLatencyTracer } from "./voice-latency-trace.js";
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

/** Tap the raw chat stream for the trace's firstToken mark — the FIRST
 *  text-chunk off the wire, upstream of the sentence buffer, because the
 *  buffer's whole job is to sit on text until a chunk closes and that wait
 *  must be measured, not hidden inside the mark. Pass-through otherwise. */
async function* tapFirstToken(
  events: AsyncIterable<ChatTurnEvent>,
): AsyncIterable<ChatTurnEvent> {
  for await (const event of events) {
    if (event.kind === "text-chunk") voiceLatencyTracer.markFirstToken();
    yield event;
  }
}

/** Run one voice turn against the spoken thread; yields the adapter's events
 *  and maps a transport failure to a 'failed' terminal (unless we aborted it). */
async function* runGlobalVoiceTurn(
  client: VynelClient,
  utterance: string,
  signal: AbortSignal,
): AsyncIterable<VoiceTurnEvent> {
  try {
    yield* adaptChatTurnStreamToVoice(
      tapFirstToken(
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
      ),
    );
  } catch (error) {
    if (signal.aborted) return;
    yield {
      kind: "failed",
      message:
        error instanceof Error ? error.message : "the brain is unreachable",
    };
  }
}

export function useVoiceSession(options: {
  /** Called once a session settles back to silence (idle timeout or end()). */
  onEnded: () => void;
  /** A recognizer actually BEGAN — the surface tells the daemon, so its native
   *  STT stops transcribing the room this session now owns. Deliberately not
   *  called for a start that could not begin (no Web Speech): announcing a
   *  session that never ran would deafen the daemon with nothing to release it. */
  onStarted?: () => void;
  /** Silence (between turns) that ends the session. The dock passes its own
   *  long window (Kafi 2026-08-28: the sidecar listens for minutes, not
   *  seconds — the user re-wakes after); omitted = the session default. */
  idleTimeoutMs?: number;
}) {
  const vynel = useVynel();
  const player = createSpokenAudioPlayer({
    // The daemon answers 503 while it has no speaking model (a fresh install
    // before Settings → Voice downloads one). Silence is indistinguishable
    // from a broken app, so say the one thing that fixes it.
    onVoiceUnavailable: () => {
      failure.value =
        "Vynel has no voice yet — download a speaking model in Settings → Voice.";
    },
  });

  const view = ref<VoiceCommandSessionView>(IDLE_VIEW);
  /** A user-actionable failure (mic denied, unsupported browser). */
  const failure = ref<string | null>(null);
  const isActive = computed(() => view.value.state !== "ended");
  // The hearing source (Settings → Voice): a cloud provider transcribes via
  // the engine's `/voice/transcribe` door — no Web Speech needed; everything
  // else is the web-speech leg exactly as before.
  const preferencesQuery = useUserPreferences();
  const usesCloudHearing = computed(() => {
    const source = preferencesQuery.data.value?.voiceSttSource;
    return source === "elevenlabs" || source === "google";
  });
  const canListen = computed(
    () => usesCloudHearing.value || isWebSpeechAvailable(),
  );

  let session: VoiceCommandSession | null = null;

  /** `turnWatchdogMs` is the daemon's silence bound carried on a wake; a
   *  manual (mic-button) start has none and the session uses its default. */
  function start(initialCommand?: string, turnWatchdogMs?: number): void {
    if (session !== null) return;
    failure.value = null;
    if (!canListen.value) {
      failure.value =
        "Voice recognition needs Chrome or Edge — this browser has no Web Speech support.";
      // A start that can't begin still ends: the owner must hear it so a wake
      // handed to a Web-Speech-less browser releases the daemon (else it stays
      // handed-off and deaf until the tab closes).
      options.onEnded();
      return;
    }

    // The user's microphone pick, resolved from its saved NAME to this
    // browser's id at capture time. Web Speech takes no device argument, so
    // only the cloud leg can honour it — the Settings row says so out loud.
    const resolveInputDeviceId = createInputDeviceResolver(
      () => preferencesQuery.data.value?.voiceInputDeviceName ?? null,
    );
    const recognizer = usesCloudHearing.value
      ? createCloudCommandRecognizer(undefined, resolveInputDeviceId)
      : createCommandRecognizer();
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
        ...(options.idleTimeoutMs !== undefined
          ? { idleTimeoutMs: options.idleTimeoutMs }
          : {}),
      },
    );
    session = started;
    // After the guard and the real start: this is the moment a web recognizer
    // owns the microphone.
    options.onStarted?.();
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

  // The OWNER'S scope, not a component's mount. Under a view the two are the
  // same moment; the Display's voice lives in a window-lifetime store instead,
  // so a session that outlives the room still ends when the window does.
  onScopeDispose(() => {
    session?.end();
  });

  return {
    view,
    failure,
    isActive,
    canListen,
    start,
    end,
    currentSessionId,
    speakExternal,
  };
}
