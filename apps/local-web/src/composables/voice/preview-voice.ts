// Play one line in the voice the user has actually chosen.
//
// The bug this replaces: Settings → Voice previewed through the spoken player,
// which fetches the DAEMON's `/voice/synthesize` — always the local model. So
// auditioning ElevenLabs voices played Kokoro every time (they all sounded
// identical, or silent with the daemon down), which reads as "the sample is
// broken" because, for the question being asked, it was.
//
// The doors, in order:
//   1. the api's provider door, which speaks with the SAVED provider voice —
//      it answers 409 when local is the chosen source;
//   2. the daemon's own `/voice/synthesize`, the local model.
// So a cloud user hears their cloud voice and a local user hears their local
// one, and neither depends on the other being available.

const PROVIDER_URL = "/api/voice/provider-synthesize";
const LOCAL_URL = "/voice/synthesize";

export type PreviewOutcome =
  | { readonly ok: true }
  /** Nothing was heard, and WHY — silence with no explanation is the thing
   *  that sent this screen's owner hunting through settings. */
  | { readonly ok: false; readonly reason: string };

async function post(url: string, text: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    return null;
  }
}

async function play(wav: Blob, deviceId: string | undefined): Promise<void> {
  const url = URL.createObjectURL(wav);
  try {
    const audio = new Audio(url);
    if (deviceId !== undefined) {
      const sinkable = audio as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (typeof sinkable.setSinkId === "function") {
        await sinkable.setSinkId(deviceId).catch(() => undefined);
      }
    }
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Speak `text` in the chosen voice, through `outputDeviceId` when one is
 *  picked. Never throws: a preview that fails says so. */
export async function playVoicePreview(
  text: string,
  outputDeviceId?: string,
): Promise<PreviewOutcome> {
  const cloud = await post(PROVIDER_URL, text);
  if (cloud !== null && cloud.ok) {
    await play(await cloud.blob(), outputDeviceId);
    return { ok: true };
  }
  // 409 is the ordinary "local is the source" answer — fall through quietly.
  // Any OTHER cloud failure is worth repeating, since the user picked cloud.
  const cloudReason =
    cloud !== null && cloud.status !== 409
      ? await cloud
          .json()
          .then((body: { message?: unknown }) =>
            typeof body.message === "string" ? body.message : null,
          )
          .catch(() => null)
      : null;

  const local = await post(LOCAL_URL, text);
  if (local !== null && local.ok) {
    await play(await local.blob(), outputDeviceId);
    return { ok: true };
  }
  if (cloudReason !== null) return { ok: false, reason: cloudReason };
  return {
    ok: false,
    reason:
      local?.status === 503
        ? "No voice is loaded yet — download one below, or start the voice daemon."
        : "The voice could not be reached. Is the voice daemon running?",
  };
}
