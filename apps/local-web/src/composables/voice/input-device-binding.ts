import { findAudioDeviceByName } from "@vynel/contracts/voice/audio-devices";

// Turns the SAVED microphone name (Settings → Voice) into the browser id the
// capture leg needs, and keeps that answer fresh.
//
// Two shapes have to meet. The preference travels as a NAME, because ids are
// origin-scoped and rotate whenever mic permission is reset — a saved id would
// silently stop matching. But `getUserMedia` binds an ID. So the name is
// resolved against what is plugged in RIGHT NOW.
//
// The resolver is synchronous because the capture leg reads it mid-acquisition
// and cannot await: it hands back the last enumeration's answer and refreshes
// in the background, so a device swapped mid-session is picked up by the next
// utterance rather than the current one.

let cachedName: string | null = null;
let cachedDeviceId: string | undefined;
let listening = false;

async function refresh(name: string | null): Promise<void> {
  const media = navigator.mediaDevices as MediaDevices | undefined;
  if (media === undefined || typeof media.enumerateDevices !== "function") return;
  if (name === null) {
    cachedName = null;
    cachedDeviceId = undefined;
    return;
  }
  let devices: MediaDeviceInfo[];
  try {
    devices = await media.enumerateDevices();
  } catch {
    return; // Keep the last good answer rather than dropping to the default.
  }
  const match = findAudioDeviceByName(
    devices
      .filter((device) => device.kind === "audioinput" && device.label !== "")
      .map((device) => ({ name: device.label, deviceId: device.deviceId })),
    name,
  );
  cachedName = name;
  // A pick whose device is unplugged resolves to undefined — the system
  // default — rather than to a stale id that would fail to open.
  cachedDeviceId = match?.deviceId;
}

/** A sync resolver for the capture leg, given a live read of the saved name.
 *  Call it per capture; it refreshes itself when the name changes or a device
 *  is plugged in. */
export function createInputDeviceResolver(
  readSavedName: () => string | null,
): () => string | undefined {
  const media = navigator.mediaDevices as MediaDevices | undefined;
  if (!listening && media !== undefined && typeof media.addEventListener === "function") {
    listening = true;
    media.addEventListener("devicechange", () => void refresh(readSavedName()));
  }
  return () => {
    const name = readSavedName();
    if (name !== cachedName) void refresh(name);
    return name === null ? undefined : cachedDeviceId;
  };
}

/** Test seam: forget what was resolved. */
export function resetInputDeviceResolverCache(): void {
  cachedName = null;
  cachedDeviceId = undefined;
  listening = false;
}
