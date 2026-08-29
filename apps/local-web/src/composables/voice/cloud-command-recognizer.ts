// The cloud half of command STT — used when Settings → Voice picks a
// provider as the hearing source. This file is the thin DOM shell: it owns
// the microphone (getUserMedia + an inline AudioWorklet) and posts each
// closed utterance to the ENGINE's `/voice/transcribe` door as WAV — the
// provider key never reaches this webview. All capture logic (segmenting,
// ordering, the silence endpoint) lives in the pure, tested
// `utterance-capture.ts`. Captions update per-utterance (request/response
// STT has no word-by-word interim — one reason web speech stays default).
//
// Echo: our own getUserMedia asks for echoCancellation (the belt); what
// leaks through is caught by the shared spoken-echo filter in
// voice-command-session.ts (the braces), same as the web-speech leg.

import { encodeWavFromPcm } from "@vynel/voice-engine/pcm-codec";
import { startUtteranceCapture } from "./utterance-capture.js";
import type { CommandRecognizer } from "./speech-recognition.js";

// Halved with the Web Speech recognizer's window (voice-latency Phase 1) —
// one number in spirit, two constants because the two recognizers share no
// module. The history lives on the other one.
const DEFAULT_ENDPOINT_SILENCE_MS = 1500;
const TRANSCRIBE_TIMEOUT_MS = 30_000;
// The mic worklet: post every 128-sample render quantum to the main thread.
const CAPTURE_WORKLET = `
class VynelCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("vynel-capture", VynelCaptureProcessor);
`;

async function transcribeUtterance(
  samples: Float32Array,
  sampleRate: number,
): Promise<string> {
  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: encodeWavFromPcm({ samples, sampleRate }),
    signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
  });
  if (!response.ok) {
    let reason = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) reason = body.error.message;
    } catch {
      // Non-JSON fault — the status is the fact.
    }
    throw new Error(`Cloud hearing failed: ${reason}`);
  }
  const body = (await response.json()) as { text?: unknown };
  return typeof body.text === "string" ? body.text : "";
}

export function createCloudCommandRecognizer(
  endpointSilenceMs = DEFAULT_ENDPOINT_SILENCE_MS,
  // The browser id of the microphone the user picked (Settings → Voice), read
  // per capture so a save is heard on the very next utterance. Undefined = the
  // system default.
  resolveInputDeviceId?: () => string | undefined,
): CommandRecognizer {
  let cancelActive: (() => void) | null = null;

  return {
    capture(onInterim: (transcript: string) => void): Promise<string | null> {
      return new Promise<string | null>((resolve, reject) => {
        let stream: MediaStream | null = null;
        let context: AudioContext | null = null;
        let workletUrl: string | null = null;
        let capture: ReturnType<typeof startUtteranceCapture> | null = null;
        let ended = false;

        const teardown = (): void => {
          ended = true;
          cancelActive = null;
          stream?.getTracks().forEach((track) => track.stop());
          stream = null;
          void context?.close().catch(() => undefined);
          context = null;
          if (workletUrl !== null) URL.revokeObjectURL(workletUrl);
          workletUrl = null;
        };

        cancelActive = () => {
          // Cancelling before the machine exists (mic prompt still up) must
          // still resolve — teardown below also stops any late-arriving tracks.
          if (capture !== null) capture.cancel();
          else {
            teardown();
            resolve(null);
          }
        };

        void (async () => {
          let acquired: MediaStream;
          try {
            // `ideal`, never `exact`: a pick whose device has since been
            // unplugged must fall back to the default microphone rather than
            // throw OverconstrainedError and leave the assistant deaf.
            const chosenDeviceId = resolveInputDeviceId?.();
            acquired = await navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                ...(chosenDeviceId === undefined
                  ? {}
                  : { deviceId: { ideal: chosenDeviceId } }),
              },
            });
          } catch {
            if (!ended) {
              teardown();
              reject(
                new Error(
                  "Microphone access was denied — allow the mic for this site to use voice.",
                ),
              );
            }
            return;
          }
          // Aborted while the permission prompt / device acquisition was up:
          // the tracks just arrived LIVE and nothing else will stop them.
          if (ended) {
            acquired.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = acquired;
          try {
            context = new AudioContext();
            workletUrl = URL.createObjectURL(
              new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
            );
            await context.audioWorklet.addModule(workletUrl);
            if (ended || context === null || stream === null) return;

            const running = startUtteranceCapture({
              transcribe: transcribeUtterance,
              onInterim,
              sampleRate: context.sampleRate,
              endpointSilenceMs,
            });
            capture = running;
            running.done
              .then((text) => {
                teardown();
                resolve(text);
              })
              .catch((error: unknown) => {
                teardown();
                reject(
                  error instanceof Error ? error : new Error(String(error)),
                );
              });

            const workletNode = new AudioWorkletNode(context, "vynel-capture");
            workletNode.port.onmessage = (
              event: MessageEvent<Float32Array>,
            ) => {
              running.pushFrame(event.data);
            };
            context.createMediaStreamSource(stream).connect(workletNode);
          } catch (error) {
            teardown();
            reject(
              new Error(
                `Voice capture could not start: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          }
        })();
      });
    },
    abort(): void {
      cancelActive?.();
      cancelActive = null;
    },
  };
}
