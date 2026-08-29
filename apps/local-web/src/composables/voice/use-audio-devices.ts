import { onScopeDispose, readonly, ref, shallowRef } from "vue";
import type { AudioDeviceDirection } from "@vynel/contracts/voice/audio-devices";

// The microphones and speakers THIS browser can offer, as a live list.
//
// Two facts shape this composable. First, device LABELS are privileged: until
// the page holds a microphone permission, `enumerateDevices()` returns entries
// with empty `label` strings, so a picker built from them would read as a list
// of blanks. We surface that state (`labelsHidden`) rather than render it.
//
// Second, the list is not static — a headset arrives, a dock is unplugged — so
// we hold `devicechange` for as long as the caller's scope lives.

export interface AudioDeviceOption {
  /** The opaque browser id, for `getUserMedia` / `setSinkId` in THIS origin. */
  readonly deviceId: string;
  /** The human name, which is also what we persist — see the contract. */
  readonly name: string;
}

export interface AudioDevices {
  readonly inputs: readonly AudioDeviceOption[];
  readonly outputs: readonly AudioDeviceOption[];
  /** True while the browser is withholding names for want of permission. */
  readonly labelsHidden: boolean;
  readonly unsupported: boolean;
  refresh(): Promise<void>;
  /** Ask for the microphone once, purely to unlock the labels, then release
   *  it immediately — this composable never holds a live capture. */
  revealLabels(): Promise<void>;
}

const DIRECTION_KIND: Record<AudioDeviceDirection, MediaDeviceKind> = {
  input: "audioinput",
  output: "audiooutput",
};

/** The browser's "system default" pseudo-device. It is not a real endpoint and
 *  its name is a label like "Default - Speakers"; null already means default
 *  everywhere in Vynel, so listing it again would be a second way to say the
 *  same thing. */
function isDefaultPseudoDevice(device: MediaDeviceInfo): boolean {
  return device.deviceId === "default" || device.deviceId === "communications";
}

function toOptions(
  devices: readonly MediaDeviceInfo[],
  direction: AudioDeviceDirection,
): AudioDeviceOption[] {
  return devices
    .filter((device) => device.kind === DIRECTION_KIND[direction])
    .filter((device) => !isDefaultPseudoDevice(device))
    .map((device) => ({ deviceId: device.deviceId, name: device.label }));
}

export function useAudioDevices(): AudioDevices {
  const inputs = shallowRef<readonly AudioDeviceOption[]>([]);
  const outputs = shallowRef<readonly AudioDeviceOption[]>([]);
  const labelsHidden = ref(false);
  const media = navigator.mediaDevices as MediaDevices | undefined;
  const unsupported = media === undefined || typeof media.enumerateDevices !== "function";

  async function refresh(): Promise<void> {
    if (unsupported) return;
    let devices: MediaDeviceInfo[];
    try {
      devices = await media.enumerateDevices();
    } catch {
      // Enumeration can refuse in a hardened context; an empty picker that
      // says "system default" is still a working screen.
      inputs.value = [];
      outputs.value = [];
      return;
    }
    const audio = devices.filter((device) => device.kind !== "videoinput");
    labelsHidden.value = audio.length > 0 && audio.every((device) => device.label === "");
    inputs.value = toOptions(audio, "input");
    outputs.value = toOptions(audio, "output");
  }

  async function revealLabels(): Promise<void> {
    if (unsupported || typeof media.getUserMedia !== "function") return;
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({ audio: true });
    } catch {
      return; // Refused: the picker stays nameless, which the UI explains.
    }
    stream.getTracks().forEach((track) => track.stop());
    await refresh();
  }

  if (!unsupported && typeof media.addEventListener === "function") {
    const onChange = () => void refresh();
    media.addEventListener("devicechange", onChange);
    onScopeDispose(() => media.removeEventListener("devicechange", onChange));
  }
  void refresh();

  return {
    get inputs() {
      return inputs.value;
    },
    get outputs() {
      return outputs.value;
    },
    get labelsHidden() {
      return readonly(labelsHidden).value;
    },
    unsupported,
    refresh,
    revealLabels,
  };
}
