import { onScopeDispose, ref, watch, type Ref } from "vue";

// A live loudness reading for ONE microphone, so a pick can be confirmed by
// speaking rather than by trusting a dropdown. Purely a meter: it opens its own
// short-lived stream, never transcribes, and holds nothing once stopped.
//
// The reading is RMS over the time domain (not an FFT bin), because what the
// eye wants here is "is sound arriving", not "at which frequency".

const FFT_SIZE = 1024;
/** Speech peaks near 0.1-0.3 RMS; scaling by 4 puts normal talking near full
 *  without a shout pinning the meter. */
const RMS_TO_BAR = 4;

export interface MicrophoneLevel {
  /** 0-1, the current loudness. 0 while stopped or silent. */
  readonly level: Readonly<Ref<number>>;
  /** True once audio is actually flowing — the mic is open and permitted. */
  readonly live: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;
  stop(): void;
}

/** Meters `deviceId` (undefined = the system default), following it when the
 *  pick changes. */
export function useMicrophoneLevel(deviceId: Ref<string | undefined>): MicrophoneLevel {
  const level = ref(0);
  const live = ref(false);
  const error = ref<string | null>(null);

  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let frame: number | null = null;

  function stop(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    void context?.close();
    context = null;
    live.value = false;
    level.value = 0;
  }

  async function start(id: string | undefined): Promise<void> {
    stop();
    error.value = null;
    const media = navigator.mediaDevices as MediaDevices | undefined;
    if (media === undefined || typeof media.getUserMedia !== "function") return;
    try {
      // `ideal`, not `exact`: an unplugged pick meters the default rather than
      // failing outright — the same rule the capture leg follows.
      stream = await media.getUserMedia({
        audio: id === undefined ? true : { deviceId: { ideal: id } },
      });
    } catch {
      error.value = "Vynel needs permission to use the microphone.";
      return;
    }
    context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    live.value = true;

    const read = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      level.value = Math.min(1, rms * RMS_TO_BAR);
      frame = requestAnimationFrame(read);
    };
    read();
  }

  watch(deviceId, (id) => void start(id), { immediate: true });
  onScopeDispose(stop);

  return { level, live, error, stop };
}
