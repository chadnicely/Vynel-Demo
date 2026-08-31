import { onBeforeUnmount, watch } from "vue";
import { useDemoStore } from "../../stores/demo-store.js";
import {
  createCommandRecognizer,
  isWebSpeechAvailable,
  type CommandRecognizer,
} from "../voice/speech-recognition.js";

// THE SET'S EARS (Chad, 2026-08-30: "if I have Ready to film on and I click
// Demo it needs to be listening" — "it's not hearing me").
//
// Arming used to mean only that a wake, IF one arrived, would run the routine
// instead of a real conversation. Nothing opened a microphone: the film waited
// on the daemon's own wake-word model, and when that did not hear him the
// screen simply sat black with no way forward.
//
// Armed now means listening. The browser's recognizer runs for the whole
// shoot, and because WHEN he speaks decides the exchange — never the words —
// any utterance advances the film. He can say his real line to camera and the
// take moves with him.
//
// It never listens while the room is speaking: the assistant's own voice
// through the speakers would otherwise advance the film mid-answer.

/** Between a capture ending and the next beginning — long enough that the tail
 *  of the assistant's own line has left the speakers. */
const REARM_MS = 350;

export function useFilmListener(): void {
  const demo = useDemoStore();
  let recognizer: CommandRecognizer | null = null;
  let running = false;

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function listen(): Promise<void> {
    if (running || !isWebSpeechAvailable()) return;
    running = true;
    // The daemon must stand down for the shoot: two listeners on one
    // microphone means one utterance advancing the film twice.
    void fetch("/voice/session/start", { method: "POST" }).catch(() => {});
    try {
      recognizer ??= createCommandRecognizer();
    } catch {
      running = false;
      return;
    }
    while (running && demo.isArmed) {
      // The room is talking; its own voice must not trigger the next beat.
      if (demo.isRoutineRunning || demo.isSpeakingLine) {
        await wait(REARM_MS);
        continue;
      }
      let heard: string | null = null;
      try {
        heard = await recognizer.capture(() => {});
      } catch {
        // A refused microphone is not something to retry in a tight loop.
        break;
      }
      if (!running || !demo.isArmed) break;
      // Silence resolves null — just listen again.
      if (heard !== null && heard.trim().length > 0) {
        if (!demo.isRoutineRunning) demo.requestSpokenRoutine(heard);
        await wait(REARM_MS);
      }
    }
    running = false;
  }

  function stop(): void {
    running = false;
    recognizer?.abort();
    recognizer = null;
    void fetch("/voice/session/end", { method: "POST" }).catch(() => {});
  }

  watch(
    () => demo.isArmed,
    (armed) => {
      if (armed) void listen();
      else stop();
    },
    { immediate: true },
  );

  onBeforeUnmount(stop);
}
