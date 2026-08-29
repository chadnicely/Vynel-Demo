import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createInputDeviceResolver,
  resetInputDeviceResolverCache,
} from "./input-device-binding.js";

function device(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: "g", toJSON: () => ({}) } as MediaDeviceInfo;
}

function fakeDevices(list: MediaDeviceInfo[]) {
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      enumerateDevices: vi.fn(async () => list),
      addEventListener: () => undefined,
    },
    configurable: true,
  });
}

const yeti = device("audioinput", "id-yeti", "Microphone (Yeti Stereo Microphone)");
const builtIn = device("audioinput", "id-builtin", "Microphone (Realtek)");

beforeEach(() => resetInputDeviceResolverCache());

/** The resolver answers synchronously off the last enumeration, so a test must
 *  let the refresh it kicks off settle before reading the second answer. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createInputDeviceResolver", () => {
  it("resolves the saved NAME to this browser's id", async () => {
    fakeDevices([builtIn, yeti]);
    const resolve = createInputDeviceResolver(() => "Microphone (Yeti Stereo Microphone)");

    resolve(); // first call kicks off the enumeration
    await settle();

    expect(resolve()).toBe("id-yeti");
  });

  it("falls back to the system default when nothing is picked", async () => {
    fakeDevices([builtIn, yeti]);
    const resolve = createInputDeviceResolver(() => null);

    resolve();
    await settle();

    expect(resolve()).toBeUndefined();
  });

  it("falls back to the default when the picked device is unplugged", async () => {
    fakeDevices([builtIn]); // the Yeti is gone
    const resolve = createInputDeviceResolver(() => "Microphone (Yeti Stereo Microphone)");

    resolve();
    await settle();

    // Undefined, NOT a stale id — a stale id would fail to open and leave the
    // assistant deaf, where undefined quietly uses the default microphone.
    expect(resolve()).toBeUndefined();
  });

  it("follows the pick when the user changes it", async () => {
    fakeDevices([builtIn, yeti]);
    let picked = "Microphone (Yeti Stereo Microphone)";
    const resolve = createInputDeviceResolver(() => picked);

    resolve();
    await settle();
    expect(resolve()).toBe("id-yeti");

    picked = "Microphone (Realtek)";
    resolve();
    await settle();
    expect(resolve()).toBe("id-builtin");
  });

  it("ignores devices whose names the browser is withholding", async () => {
    fakeDevices([device("audioinput", "id-blank", "")]);
    const resolve = createInputDeviceResolver(() => "Microphone (Yeti Stereo Microphone)");

    resolve();
    await settle();

    expect(resolve()).toBeUndefined();
  });
});
