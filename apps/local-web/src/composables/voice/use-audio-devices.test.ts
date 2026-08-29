import { describe, expect, it, vi, afterEach } from "vitest";
import { effectScope } from "vue";
import { useAudioDevices } from "./use-audio-devices.js";

function device(overrides: Partial<MediaDeviceInfo>): MediaDeviceInfo {
  return {
    deviceId: "id",
    kind: "audioinput",
    label: "A device",
    groupId: "g",
    toJSON: () => ({}),
    ...overrides,
  } as MediaDeviceInfo;
}

const listeners = new Map<string, () => void>();

function fakeMediaDevices(devices: MediaDeviceInfo[], getUserMedia?: () => Promise<MediaStream>) {
  const enumerateDevices = vi.fn(async () => devices);
  const media = {
    enumerateDevices,
    getUserMedia: getUserMedia ?? vi.fn(),
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  Object.defineProperty(navigator, "mediaDevices", { value: media, configurable: true });
  return { enumerateDevices };
}

/** Run the composable inside a scope so `onScopeDispose` has somewhere to land. */
async function mount(): Promise<{ devices: ReturnType<typeof useAudioDevices>; stop(): void }> {
  const scope = effectScope();
  const devices = scope.run(() => useAudioDevices())!;
  await devices.refresh();
  return { devices, stop: () => scope.stop() };
}

afterEach(() => listeners.clear());

describe("useAudioDevices", () => {
  it("splits inputs from outputs and keeps their names", async () => {
    fakeMediaDevices([
      device({ deviceId: "mic-1", kind: "audioinput", label: "Microphone (Realtek)" }),
      device({ deviceId: "spk-1", kind: "audiooutput", label: "Speakers (USB Audio)" }),
      device({ deviceId: "cam-1", kind: "videoinput", label: "Webcam" }),
    ]);
    const { devices, stop } = await mount();

    expect(devices.inputs).toEqual([{ deviceId: "mic-1", name: "Microphone (Realtek)" }]);
    expect(devices.outputs).toEqual([{ deviceId: "spk-1", name: "Speakers (USB Audio)" }]);
    stop();
  });

  it("drops the browser's default pseudo-devices — null already means default", async () => {
    fakeMediaDevices([
      device({ deviceId: "default", kind: "audiooutput", label: "Default - Speakers" }),
      device({ deviceId: "communications", kind: "audiooutput", label: "Communications" }),
      device({ deviceId: "spk-1", kind: "audiooutput", label: "Speakers (USB Audio)" }),
    ]);
    const { devices, stop } = await mount();

    expect(devices.outputs.map((option) => option.deviceId)).toEqual(["spk-1"]);
    stop();
  });

  it("reports labels as hidden when the browser withholds every name", async () => {
    fakeMediaDevices([
      device({ deviceId: "mic-1", kind: "audioinput", label: "" }),
      device({ deviceId: "spk-1", kind: "audiooutput", label: "" }),
    ]);
    const { devices, stop } = await mount();

    expect(devices.labelsHidden).toBe(true);
    stop();
  });

  it("re-reads the list when a device is plugged in or pulled out", async () => {
    const { enumerateDevices } = fakeMediaDevices([
      device({ deviceId: "mic-1", kind: "audioinput", label: "Microphone" }),
    ]);
    const { devices, stop } = await mount();
    const before = enumerateDevices.mock.calls.length;

    listeners.get("devicechange")?.();
    await vi.waitFor(() => expect(enumerateDevices.mock.calls.length).toBeGreaterThan(before));

    expect(devices.inputs).toHaveLength(1);
    stop();
  });

  it("releases the microphone it opened purely to reveal names", async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    fakeMediaDevices(
      [device({ deviceId: "mic-1", kind: "audioinput", label: "Microphone" })],
      async () => stream,
    );
    const { devices, stop } = await mount();

    await devices.revealLabels();

    expect(stopTrack).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stays quiet when the microphone is refused", async () => {
    fakeMediaDevices([device({ deviceId: "mic-1", kind: "audioinput", label: "" })], async () => {
      throw new Error("NotAllowedError");
    });
    const { devices, stop } = await mount();

    await expect(devices.revealLabels()).resolves.toBeUndefined();
    stop();
  });
});
