// The process-wide "swapping right now" register — which continuing identities
// are mid seed-fresh swap at this instant. Held only for the seconds between
// the distill starting and the primary repointing (`bridgePrimarySession`
// marks and clears it in a try/finally). Read by the streams when a turn
// PARKS behind a target lock: a composer waiting on a swap should say
// "patching context", not "working on a task". Same shape as the root-turn
// lock's module-level state — one process, one register, no persistence (a
// crash mid-swap leaves nothing behind to clear).

const swappingPrimaryIds = new Set<string>()

export function markPrimarySwapping(primarySessionId: string): void {
  swappingPrimaryIds.add(primarySessionId)
}

export function clearPrimarySwapping(primarySessionId: string): void {
  swappingPrimaryIds.delete(primarySessionId)
}

export function isPrimarySwapping(primarySessionId: string): boolean {
  return swappingPrimaryIds.has(primarySessionId)
}
