// The internal side-channel carrying the delegating turn's PERMISSION MODE from the
// global-root turn runner to the `POST /routing/message` route (surface-up step 1).
// The runner wraps its app dispatcher to set this header on every routing request; the
// delegate route reads it and stamps the mode onto the enqueued `delegation_jobs` row,
// so the routed workspace turn runs under the mode the user picked for the turn that
// spawned it.
//
// Why a header (not a request-body field): same reason as `DELEGATION_ORIGIN_HEADER` —
// the delegate request is built by the auto-generated routing MCP tool from the model's
// tool input, and the mode is AMBIENT turn context the model never sees. Internal;
// never part of the OpenAPI contract.

import type { DelegationPermissionMode } from '@vynel/orchestration'

export const DELEGATION_MODE_HEADER = 'x-vynel-delegation-mode'

const DELEGATION_PERMISSION_MODES: readonly DelegationPermissionMode[] = [
  'ask',
  'auto',
  'bypass',
  'bypass-with-behavior-gate',
]

/** Parse the mode header at the route boundary — defensively (an absent/unknown value
 *  yields `undefined`, i.e. the pre-mode default, never a thrown turn). */
export function parseDelegationModeHeader(
  headerValue: string | undefined,
): DelegationPermissionMode | undefined {
  if (headerValue === undefined) return undefined
  return DELEGATION_PERMISSION_MODES.find((mode) => mode === headerValue)
}
