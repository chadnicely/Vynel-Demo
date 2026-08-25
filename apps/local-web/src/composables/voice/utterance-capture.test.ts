import { afterEach, describe, expect, it, vi } from "vitest";
import { startUtteranceCapture, type UtteranceCaptureDeps } from "./utterance-capture.js";

// 16 kHz frames: constant 0.1 amplitude = clear speech; zeros = silence. The
// segmenter closes an utterance after ~550 ms of silence following speech.
const SAMPLE_RATE = 16_000;
const speechFrame = (ms: number) => new Float32Array((SAMPLE_RATE * ms) / 1000).fill(0.1);
const silenceFrame = (ms: number) => new Float32Array((SAMPLE_RATE * ms) / 1000);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function build(overrides: Partial<UtteranceCaptureDeps> = {}) {
  const interims: string[] = [];
  const transcribed: Float32Array[] = [];
  const capture = startUtteranceCapture({
    transcribe: async (samples) => {
      transcribed.push(samples);
      return "hello there";
    },
    onInterim: (transcript) => interims.push(transcript),
    sampleRate: SAMPLE_RATE,
    endpointSilenceMs: 3000,
    ...overrides,
  });
  return { capture, interims, transcribed };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("startUtteranceCapture", () => {
  it("transcribes each closed utterance, captions per utterance, resolves after true silence", async () => {
    vi.useFakeTimers();
    const { capture, interims, transcribed } = build();

    capture.pushFrame(speechFrame(600));
    capture.pushFrame(silenceFrame(700)); // closes the utterance
    await vi.advanceTimersByTimeAsync(0); // the transcription chain settles
    expect(transcribed).toHaveLength(1);
    expect(interims).toEqual(["hello there"]);

    await vi.advanceTimersByTimeAsync(3100); // the endpoint fires
    await expect(capture.done).resolves.toBe("hello there");
  });

  it("ongoing SPEECH holds the endpoint open past the initial deadline", async () => {
    vi.useFakeTimers();
    const { capture } = build();
    let settled = false;
    void capture.done.finally(() => {
      settled = true;
    });

    // Talk in 500 ms bursts for 5 s straight — well past one 3 s deadline.
    for (let burst = 0; burst < 10; burst += 1) {
      capture.pushFrame(speechFrame(500));
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(settled).toBe(false); // still listening — the user was speaking

    capture.pushFrame(silenceFrame(700));
    await vi.advanceTimersByTimeAsync(3100);
    await expect(capture.done).resolves.toBe("hello there");
  });

  it("an endpoint firing over a PENDING transcription waits for it — the command is never dropped", async () => {
    vi.useFakeTimers();
    const slow = deferred<string>();
    const { capture, interims } = build({ transcribe: () => slow.promise });

    capture.pushFrame(speechFrame(600));
    capture.pushFrame(silenceFrame(700)); // utterance closed; provider round-trip begins
    await vi.advanceTimersByTimeAsync(3100); // silence outlives the endpoint while the answer is in flight
    let resolvedTo: string | null | undefined;
    void capture.done.then((text) => {
      resolvedTo = text;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolvedTo).toBeUndefined(); // held open for the in-flight answer

    slow.resolve("the late answer");
    await vi.advanceTimersByTimeAsync(0);
    expect(resolvedTo).toBe("the late answer");
    expect(interims).toEqual(["the late answer"]);
  });

  it("plain silence resolves null; cancel resolves null immediately", async () => {
    vi.useFakeTimers();
    const silent = build();
    silent.capture.pushFrame(silenceFrame(200));
    await vi.advanceTimersByTimeAsync(3100);
    await expect(silent.capture.done).resolves.toBeNull();

    const cancelled = build();
    cancelled.capture.pushFrame(speechFrame(600));
    cancelled.capture.cancel();
    await expect(cancelled.capture.done).resolves.toBeNull();
  });

  it("a transcription fault rejects with its actionable message", async () => {
    vi.useFakeTimers();
    const { capture } = build({
      transcribe: async () => {
        throw new Error("Cloud hearing failed: ElevenLabs rejected the stored API key");
      },
    });
    capture.pushFrame(speechFrame(600));
    capture.pushFrame(silenceFrame(700));
    await expect(capture.done).rejects.toThrow("ElevenLabs rejected the stored API key");
  });
});
