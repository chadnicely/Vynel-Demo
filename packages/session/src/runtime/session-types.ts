// The session-runtime type surface for `@vynel/session`. Describes the runner
// contract — the sink the runner drives with the unified `ChatTurnEvent` stream.
// Consumed by the runner here (`run-global-root-turn-core.ts`) and by the apps/api
// sink-builders that drive it; the generic `runSessionTurn` (all scopes) lands in a
// later unit.
//
// IMPORTANT — kept OUT of the package barrel (`../index.ts`, which re-exports the
// web-safe mode model ONLY). This module is reached via the `@vynel/session/runtime`
// subpath so `apps/web` (which imports the mode model) never pulls `@vynel/chat` /
// `@vynel/providers` into the web bundle. The `import type` below is erased at
// compile time; bundle-safety comes from the import graph, not the manifest.

import type { ChatTurnEvent } from '@vynel/chat'

/**
 * The single per-path divergence axis of a session turn. The runner drives the
 * unified `ChatTurnEvent` stream (translated + persisted by
 * `consumeSessionEventStream`); everything that differs BY DESTINATION — stream to
 * SSE, accumulate for a background drain — lives behind this sink.
 *
 * Error handling is deliberately TWO channels, and they are NOT interchangeable
 * (collapsing them changes the wire bytes — the additive invariant in the migration
 * roadmap):
 * - An in-stream `session-errored` event flows through `onEvent` like any other
 *   event (an SSE sink writes the full event frame; a drain sink captures it). The
 *   stream then ends normally, so `onEnd` still fires.
 * - A THROWN exception (provider/setup failure) is caught by the runner and routed
 *   to `onError`; `onEnd` is NOT reached. An SSE sink writes a minimal
 *   `session-errored` frame here — a DIFFERENT shape from the in-stream event; a
 *   drain sink omits `onError` so the runner re-throws to its caller.
 */
export interface SessionSink {
  /** Called for every `ChatTurnEvent`, in order, as the runner drains the turn. */
  onEvent(event: ChatTurnEvent): void | Promise<void>

  /**
   * Called once after the stream drains cleanly (no thrown exception). An SSE sink
   * emits its `turn-stream-ended` frame here; a drain sink may throw here to surface
   * an in-stream error it captured during `onEvent`.
   */
  onEnd?(): void | Promise<void>

  /**
   * Called when the runner catches a thrown exception — NOT for an in-stream
   * `session-errored` event (that goes through `onEvent`). An SSE sink writes its
   * error frame; a drain sink omits this so the runner re-throws.
   */
  onError?(error: unknown): void | Promise<void>
}
