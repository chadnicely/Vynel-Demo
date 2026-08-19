// FIFO access to the daemon's single-flight speaker. `LineSpeaker` refuses a
// second line while one is in flight (the caller must serialize) — and the
// wake line has three producers that can want it at once: a turn's streamed
// reply, the next turn's reply after a barge-in (the cut line is still
// settling), and the relay queue (the `speak` tool, the watchdog line). A
// thrown line is a silently lost announcement, so every speaker use reserves
// the lane and whoever reserved first speaks first.

export class SpeechLane {
  #tail: Promise<unknown> = Promise.resolve()

  /** Run `speak` once every earlier reservation has settled. Resolves/rejects
   *  with `speak`'s own outcome; a rejection never blocks the lane. */
  reserve<T>(speak: () => Promise<T>): Promise<T> {
    const turn = this.#tail.then(speak, speak)
    this.#tail = turn.catch(() => undefined)
    return turn
  }
}
