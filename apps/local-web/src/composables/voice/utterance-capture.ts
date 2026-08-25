// The pure state machine of one cloud-heard command: mic frames in,
// RMS-segmented utterances transcribed in order, ONE resolved transcript
// out after true silence. Headless on purpose — the DOM shell
// (cloud-command-recognizer.ts) owns getUserMedia/AudioWorklet and feeds
// `pushFrame`; everything testable lives here.

import { SpeechSegmenter } from "@vynel/voice";

// Matches the segmenter's quiet-room default — the endpoint countdown resets
// while the user is audibly SPEAKING, not only when a transcript lands, so a
// long sentence is never cut at the initial deadline.
const SPEECH_RMS_THRESHOLD = 0.012;

export interface UtteranceCaptureDeps {
  /** Transcribe one closed utterance (the engine's cloud door). */
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
  onInterim(transcript: string): void;
  sampleRate: number;
  /** A pause this long (with nothing left in flight) = the user is done. */
  endpointSilenceMs: number;
}

export interface UtteranceCapture {
  pushFrame(frame: Float32Array): void;
  /** End early (abort/teardown) — `done` resolves null unless already settled. */
  cancel(): void;
  /** The final transcript; null for silence/abort; rejects on a transcription
   *  fault (user-visible — the overlay's failure line). */
  readonly done: Promise<string | null>;
}

export function startUtteranceCapture(deps: UtteranceCaptureDeps): UtteranceCapture {
  const segmenter = new SpeechSegmenter({ sampleRate: deps.sampleRate });
  let committed = "";
  let settled = false;
  let endpointTimer: ReturnType<typeof setTimeout> | null = null;
  // Utterances transcribe in arrival order — a chained queue, so a slow
  // provider answer can never land text out of sequence.
  let transcriptionChain: Promise<void> = Promise.resolve();

  let settle!: (outcome: { text: string | null } | { error: Error }) => void;
  const done = new Promise<string | null>((resolve, reject) => {
    settle = (outcome) => {
      if (settled) return;
      settled = true;
      if (endpointTimer !== null) clearTimeout(endpointTimer);
      endpointTimer = null;
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.text);
    };
  });

  const restartEndpoint = (): void => {
    if (settled) return;
    if (endpointTimer !== null) clearTimeout(endpointTimer);
    endpointTimer = setTimeout(() => {
      // A provider round-trip may still be carrying the command — the silence
      // decides WHEN the capture ends, the chain decides WHAT it heard.
      void transcriptionChain.then(() => settle({ text: committed.trim() || null }));
    }, deps.endpointSilenceMs);
  };
  // Armed from the first moment: a capture that never hears speech at all
  // must still resolve (null) instead of listening forever.
  restartEndpoint();

  return {
    pushFrame(frame: Float32Array): void {
      if (settled) return;
      if (looksLikeSpeech(frame)) restartEndpoint();
      for (const utterance of segmenter.push(frame)) {
        transcriptionChain = transcriptionChain.then(async () => {
          if (settled) return;
          try {
            const text = (await deps.transcribe(utterance, deps.sampleRate)).trim();
            if (settled || text === "") return;
            committed = `${committed} ${text}`.trim();
            deps.onInterim(committed);
            restartEndpoint();
          } catch (error) {
            settle({ error: error instanceof Error ? error : new Error(String(error)) });
          }
        });
      }
    },
    cancel(): void {
      settle({ text: null });
    },
    done,
  };
}

function looksLikeSpeech(frame: Float32Array): boolean {
  let energy = 0;
  for (let index = 0; index < frame.length; index += 1) energy += frame[index]! * frame[index]!;
  return Math.sqrt(energy / Math.max(1, frame.length)) > SPEECH_RMS_THRESHOLD;
}
