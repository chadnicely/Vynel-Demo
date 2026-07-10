import { ref, type Ref } from "vue";
import {
  createCommandRecognizer,
  isWebSpeechAvailable,
  type CommandRecognizer,
} from "./speech-recognition.js";

// Dictation for the chat composer: speech becomes TEXT IN THE DRAFT — typing
// help for people who'd rather talk than type, nothing more. It never opens
// the voice overlay and never sends; the user reads what was heard and
// presses Send themselves. (Talking WITH the assistant is the top-bar mic's
// job — that one opens the Jarvis overlay.)

export interface UseDictationOptions {
  /** Test seams — default to the real Web Speech recognizer. */
  recognizerFactory?: () => CommandRecognizer;
  isAvailable?: () => boolean;
}

export interface DictationControls {
  readonly isDictating: Ref<boolean>;
  readonly error: Ref<string | null>;
  /** Mic button: start listening, or stop and keep what was heard. */
  toggle(): void;
  /** Stop and keep what was heard so far. */
  stop(): void;
  /** Stop and DROP what was heard — the draft was just sent, so a late
   *  transcript must not resurrect into the cleared box. */
  cancel(): void;
}

export function useDictation(
  draft: Ref<string>,
  options: UseDictationOptions = {},
): DictationControls {
  const recognizerFactory = options.recognizerFactory ?? createCommandRecognizer;
  const isAvailable = options.isAvailable ?? isWebSpeechAvailable;

  const isDictating = ref(false);
  const error = ref<string | null>(null);
  let active: CommandRecognizer | null = null;
  let discardCapture = false;

  async function start(): Promise<void> {
    if (isDictating.value) return;
    if (!isAvailable()) {
      error.value =
        "Voice typing needs the Vynel desktop app (or the Chrome/Edge browser).";
      return;
    }
    error.value = null;
    discardCapture = false;
    isDictating.value = true;
    // Dictated words append after whatever's already typed.
    const base = draft.value.trim().length > 0 ? `${draft.value.trimEnd()} ` : "";
    const recognizer = recognizerFactory();
    active = recognizer;
    try {
      const heard = await recognizer.capture((interim) => {
        if (!discardCapture) draft.value = `${base}${interim}`;
      });
      if (!discardCapture && heard !== null) draft.value = `${base}${heard}`;
    } catch (captureError) {
      error.value =
        captureError instanceof Error
          ? captureError.message
          : "The microphone could not start — check that another app isn't using it.";
    } finally {
      isDictating.value = false;
      active = null;
    }
  }

  function stop(): void {
    active?.abort();
  }

  function cancel(): void {
    discardCapture = true;
    active?.abort();
  }

  function toggle(): void {
    if (isDictating.value) stop();
    else void start();
  }

  return { isDictating, error, toggle, stop, cancel };
}
