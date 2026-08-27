// Ask the voice daemon to end its NATIVE conversation (fall back asleep and
// wait for the next wake). Best-effort, the `speak` precedent: the browser
// legs are stopped by the `voice-stop` control frame on the live channel —
// this door only covers a conversation the daemon itself is running, so a
// daemon that isn't running simply has nothing to stop.

const STOP_TIMEOUT_MS = 5_000

export async function stopListeningThroughDaemon(daemonUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${daemonUrl}/stop-listening`, {
      method: 'POST',
      signal: AbortSignal.timeout(STOP_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}
