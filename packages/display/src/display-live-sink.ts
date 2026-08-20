// The seam between the leaf and the live channel. The leaf may not import
// `@vynel/session` (sibling leaf), so the push target arrives STRUCTURALLY:
// whoever wires the app (P2c: `boot.ts` / `factory.ts`) hands the ops an
// object with a `publish` method and the leaf stays ignorant of WebSockets.
//
// Two rules the implementation owns:
//   - `publish` is called AFTER the transaction commits, never inside it — a
//     frame for a write that later rolled back would leave a phantom card on
//     screen that no reload reproduces.
//   - `publish` MUST NOT throw. The state change is already durable by then
//     and the outbox row is its record; a failing socket must not turn a
//     successful add into an error the caller sees.

import type { DisplayLiveFrame } from '@vynel/contracts/display/display-live'

export interface DisplayLiveSink {
  publish(frame: DisplayLiveFrame): void
}

/** The optional dependency every display op accepts. */
export interface DisplayOpDeps {
  liveSink?: DisplayLiveSink
}
