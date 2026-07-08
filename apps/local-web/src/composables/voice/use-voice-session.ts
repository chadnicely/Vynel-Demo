import { computed, onUnmounted, ref } from "vue";
import type { VynelClient } from "@vynel/sdk";
import { useVynel } from "../use-vynel.js";
import { streamChatTurnEvents } from "../chat/chat-turn-stream.js";
import {
  createCommandRecognizer,
  isWebSpeechAvailable,
} from "./speech-recognition.js";
import { createSpokenAudioPlayer } from "./spoken-audio-player.js";
import {
  startVoiceCommandSession,
  type VoiceCommandSession,
  type VoiceCommandSessionView,
  type VoiceTurnEvent,
} from "./voice-command-session.js";

// Binds one browser voice-command session to Vue state for the Jarvis overlay:
// Web Speech STT in, a global `/root/turn` per command on the fast voice model.
// The browser NEVER speaks — voice output happens only when the brain calls the
// `speak` tool, which plays through the daemon's speaker. This composable turns
// each `speak` call in the stream into a 'spoke' view update.

// The small, fast model voice turns run on (the light triage tier).
const VOICE_MODEL = "claude-haiku-4-5";
// The brain-surface tool the model calls to talk (mcp__vynel__<name>).
const SPEAK_TOOL_NAME = "mcp__vynel__speak";

const IDLE_VIEW: VoiceCommandSessionView = {
  state: "ended",
  transcript: "",
  spokenText: "",
};

/** Pull the spoken text out of a `speak` tool call's input ({ text }). */
function extractSpokenText(toolInput: unknown): string | null {
  if (typeof toolInput === "object" && toolInput !== null && "text" in toolInput) {
    const text = (toolInput as { text: unknown }).text;
    if (typeof text === "string" && text.trim() !== "") return text;
  }
  return null;
}

/** Adapt the chat-turn SSE stream to the session's events: surface each `speak`
 *  tool call (what the daemon is saying) + the terminal. The streamed TEXT is
 *  ignored — it's the on-screen record, never voice. */
async function* runGlobalVoiceTurn(
  client: VynelClient,
  utterance: string,
  signal: AbortSignal,
): AsyncIterable<VoiceTurnEvent> {
  try {
    for await (const event of streamChatTurnEvents(client, {
      scope: { kind: "global" },
      userMessageText: utterance,
      model: VOICE_MODEL, // the small, fast voice model
      voice: true, // reply via the speak tool; nothing here is read aloud
      signal,
    })) {
      if (event.kind === "tool-call-started" && event.toolCall.toolName === SPEAK_TOOL_NAME) {
        const text = extractSpokenText(event.toolCall.toolInput);
        if (text !== null) yield { kind: "spoke", text };
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
