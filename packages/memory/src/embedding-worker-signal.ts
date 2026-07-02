// `signalEmbeddingWorker` — Phase 1 no-op stub. Phase 1 ships
// cron-only scheduling for the embedding worker (`*/1 * * * *`). The
// signal-on-write hybrid was rejected — the user-visible latency
// delta between 1s and 60s is invisible for the visible-memory
// product surface.
//
// This stub is invoked from create-memory-entry + update-memory-entry
// (when the body changes) so callers don't sprout conditional
// `if (signalEnabled)` branches — the contract holds even when the
// signal is a no-op.
//
// When/if the signal-on-write path lands (a foundation-hardening
// item), this becomes a real implementation — pushes a
// `WorkerSignal` into a shared queue the scheduler watches
// alongside cron ticks. Until then, every call returns immediately.

export function signalEmbeddingWorker(): void {
  // Intentionally empty — Phase 1 cron-only.
}
