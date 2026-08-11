// Serialize an async function: calls run strictly one-after-another, in call
// order. The native sherpa engines are SINGLE instances shared by the wake
// line and every call loop; concurrent decode/generate on one addon instance
// is not a documented-safe surface, so every caller queues through this.
export function serializeAsync<Args extends unknown[], Result>(
  run: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  let tail: Promise<unknown> = Promise.resolve()
  return (...args: Args): Promise<Result> => {
    const result = tail.then(() => run(...args))
    // A rejection must fail ITS caller without wedging the queue.
    tail = result.catch(() => undefined)
    return result
  }
}
