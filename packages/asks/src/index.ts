// Public surface of `@vynel/asks` — the asks leaf (Claude asks the user for
// inputs through a form wizard; the turn blocks until they answer). Consumers
// reach the package only through this barrel; schema, repositories and the
// concern folders are internal.
//
// DELIBERATELY SDK-FREE: the `ask_user` descriptor (which pulls the agent-SDK
// builder) lives on the `./mcp` subpath so route modules can import the ops
// statically while the turn streams dynamic-import the descriptor (the
// established keep-the-heavy-SDK-out-of-module-load pattern).

export type { StructuralLogger, AskOutcome } from './asks-types.js'
export type { AskRequest, AskRequestStatus } from './repositories/index.js'

export {
  ASK_CREATED,
  ASK_RESOLVED,
  type AskCreatedPayload,
  type AskResolvedPayload,
} from './asks-events.js'

// Lifecycle + read ops (sync).
export { createAskRequest, type CreateAskRequestInput } from './lifecycle/create-ask-request.js'
export {
  resolveAskRequest,
  type ResolveAskRequestInput,
  type ResolveAskResolution,
} from './lifecycle/resolve-ask-request.js'
export { expireAskRequests } from './lifecycle/expire-ask-requests.js'
export { listPendingAsks } from './queries/list-pending-asks.js'

// The blocking bridge's registry half (SDK-free); the descriptor half is on
// the `./mcp` subpath.
export { PendingAskRegistry, type PendingAskRecord } from './waiting/pending-ask-registry.js'
