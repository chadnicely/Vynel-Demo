// The internal side-channel carrying a channel-originated delegation's ORIGIN from the
// global-root turn runner to the `POST /routing/delegate` route (brain-tree Ch4). The runner
// (`runGlobalRootTurn`) wraps its app dispatcher to set this header on every routing request;
// the delegate route reads it and stamps the origin onto the enqueued `delegation_jobs` row, so
// the report is later delivered back to the channel the user asked from.
//
// Why a header (not a request-body field): the delegate request is built by the AUTO-GENERATED
// routing MCP tool (`route_to_workspace`) from the model's tool input — the origin is AMBIENT
// turn context the model never sees, so it rides beside the request, not inside it. Internal +
// race-free (the origin is on the job at enqueue time); never part of the OpenAPI contract.
//
// CONSUMER DEFERRED: `parseDelegationOriginHeader` is the delegate-route half. That route
// (`POST /routing/delegate`) has not landed in KLONE yet, so this parser is currently unused and
// the stamped header is INERT — the wrapping is correct and harmless (a header no one reads).
// The parser is kept here, beside its serializer, so the route reads it from one home when it lands.

import type { DelegationOrigin } from '@vynel/orchestration'

export const DELEGATION_ORIGIN_HEADER = 'x-vynel-delegation-origin'

export function serializeDelegationOrigin(origin: DelegationOrigin): string {
  return JSON.stringify(origin)
}

/** Parse the origin header at the route boundary — defensively (a malformed/absent header yields
 *  `undefined`, i.e. a non-channel origin with no delivery, never a thrown turn). */
export function parseDelegationOriginHeader(
  headerValue: string | undefined,
): DelegationOrigin | undefined {
  if (headerValue === undefined || headerValue === '') return undefined
  try {
    const parsed = JSON.parse(headerValue) as Partial<DelegationOrigin>
    if (
      typeof parsed.channelId === 'string' &&
      typeof parsed.externalSenderId === 'string' &&
      typeof parsed.externalChatContextId === 'string'
    ) {
      return {
        channelId: parsed.channelId,
        externalSenderId: parsed.externalSenderId,
        externalChatContextId: parsed.externalChatContextId,
      }
    }
    return undefined
  } catch {
    return undefined
  }
}
