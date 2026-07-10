import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useDictation } from "./use-dictation.js";
import type { CommandRecognizer } from "./speech-recognition.js";

// A hand-driven recognizer: the test fires interim results and settles the
// capture itself, standing in for Web Speech.
function createFakeRecognizer() {
  let emitInterim: ((transcript: string) => void) | null = null;
  let settle: ((finalText: string | null) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  let lastHeard: string | null = null;

  const recognizer: CommandRecognizer = {
    capture(onInterim) {
      emitInterim = (transcript) => {
        lastHeard = transcript;
        onInterim(transcript);
      };
      return new Promise((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
    },
    abort() {
      // Mirrors the real recognizer: aborting resolves with what was heard.
      settle?.(lastHeard);
    },
  };

  return {
    recognizer,
    interim: (text: string) => emitInterim?.(text),
    finish: (text: string | null) => settle?.(text),
    failWith: (error: Error) => fail?.(error),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useDictation", () => {
  it("streams interim words into the draft and keeps the final transcript", async () => {
    const fake = createFakeRecognizer();
    const draft = ref("");
    const dictation = useDictation(draft, {
      recognizerFactory: () => fake.recognizer,
      isAvailable: () => true,
    });

    dictation.toggle();
    await flush();
    expect(dictation.isDictating.value).toBe(true);

    fake.interim("hello");
    expect(draft.value).toBe("hello");
    fake.interim("hello there");
    expect(draft.value).toBe("hello there");

    fake.finish("hello there friend");
    await flush();
    expect(draft.value).toBe("hello there friend");
    expect(dictation.isDictating.value).toBe(false);
  });

  it("appends after existing typed text", async () => {
    const fake = createFakeRecognizer();
    const draft = ref("So far ");
    const dictation = useDictation(draft, {
      recognizerFactory: () => fake.recognizer,
      isAvailable: () => true,
    });

    dictation.toggle();
    await flush();
    fake.interim("so good");
    expect(draft.value).toBe("So far so good");
  });

  it("cancel() drops in-flight words instead of resurrecting them after send", async () => {
    const fake = createFakeRecognizer();
    const draft = ref("");
    const dictation = useDictation(draft, {
      recognizerFactory: () => fake.recognizer,
      isAvailable: () => true,
    });

    dictation.toggle();
    await flush();
    fake.interim("send this");

    // The send: the draft clears, then dictation is cancelled.
    draft.value = "";
    dictation.cancel();
    await flush();
    expect(draft.value).toBe("");
    expect(dictation.isDictating.value).toBe(false);
  });

  it("surfaces a mic-permission failure as an actionable error", async () => {
    const fake = createFakeRecognizer();
    const draft = ref("");
    const dictation = useDictation(draft, {
      recognizerFactory: () => fake.recognizer,
      isAvailable: () => true,
    });

    dictation.toggle();
    await flush();
    fake.failWith(new Error("Microphone access was denied — allow the mic."));
    await flush();

    expect(dictation.error.value).toContain("Microphone access was denied");
    expect(dictation.isDictating.value).toBe(false);
  });

  it("explains itself when Web Speech is unavailable", async () => {
    const draft = ref("");
    const dictation = useDictation(draft, {
      recognizerFactory: () => {
        throw new Error("should not be constructed");
      },
      isAvailable: () => false,
    });

    dictation.toggle();
    await flush();
    expect(dictation.error.value).toContain("Voice typing");
    expect(dictation.isDictating.value).toBe(false);
  });
});
