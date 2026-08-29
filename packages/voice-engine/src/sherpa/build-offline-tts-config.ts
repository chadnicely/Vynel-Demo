import { cpus } from "node:os";
import type { OfflineTtsConfig } from "./native.js";
import type { TtsModelConfig } from "../voice-engine.js";

// Map Vynel's model-agnostic `TtsModelConfig` onto sherpa-onnx's `OfflineTtsConfig`.
// Pure + exhaustive so the mapping is unit-tested without loading a native model
// (the model files can't ride the gate). The CPU provider is fixed — Vynel voice
// is a local, GPU-free experience by design.

// 4, up from 2 (voice-latency Phase 1, Kafi 2026-08-27): the first sentence's
// synthesis sits on the reply's critical path — the room is silent until it
// lands — and Kokoro on 2 threads was the third-largest slice of that wait.
// Doubling the threads roughly halves it on any modern 8+-core machine, and
// synthesis is BURSTY (one sentence at a time, prefetch depth 1), so this is
// not a sustained load on the box.
// Fixed at 4 until 2026-08-29, when Kokoro took 7.6s for "Good evening" and
// 16.6s for a full sentence on an 8-core box — a preview that reads as broken.
// 4 was chosen as "any modern 8+-core machine", but hard-coding it left half of
// exactly those machines idle. Scale to the box instead, keeping two cores for
// the wake leg (VAD + STT run continuously beside this) and never dropping
// below the old floor of 2.
function defaultNumThreads(): number {
  const cores = cpus().length;
  return Math.max(2, Math.min(8, cores - 2));
}
const CPU_PROVIDER = "cpu";

export interface BuildOfflineTtsConfigInput {
  readonly tts: TtsModelConfig;
  /** Inference threads. Defaults to the machine's cores minus two — first-
   *  sentence latency over politeness, without starving the wake leg. */
  readonly numThreads?: number;
  /** Split cap for long text. Undefined = the model default. */
  readonly maxNumSentences?: number;
}

export function buildOfflineTtsConfig(
  input: BuildOfflineTtsConfigInput,
): OfflineTtsConfig {
  const base = {
    numThreads: input.numThreads ?? defaultNumThreads(),
    provider: CPU_PROVIDER,
    ...(input.maxNumSentences !== undefined
      ? { maxNumSentences: input.maxNumSentences }
      : {}),
  };

  const tts = input.tts;
  switch (tts.kind) {
    case "kokoro":
      return {
        ...base,
        model: {
          kokoro: {
            model: tts.model,
            voices: tts.voices,
            tokens: tts.tokens,
            dataDir: tts.dataDir,
            ...(tts.lengthScale !== undefined
              ? { lengthScale: tts.lengthScale }
              : {}),
          },
        },
      };
    case "vits":
      return {
        ...base,
        model: {
          vits: {
            model: tts.model,
            tokens: tts.tokens,
            dataDir: tts.dataDir,
            ...(tts.lengthScale !== undefined
              ? { lengthScale: tts.lengthScale }
              : {}),
          },
        },
      };
    default:
      return assertUnreachableModel(tts);
  }
}

// Compile-time exhaustiveness + a runtime guard for a config that slipped past
// the types (e.g. a hand-built JSON from a future model kind). This is an
// internal invariant breach at engine construction, not user input — a bare
// Error (→ 500 via the api's onError) is the honest classification.
function assertUnreachableModel(model: never): never {
  throw new Error(`Unsupported TTS model kind: ${JSON.stringify(model)}`);
}
