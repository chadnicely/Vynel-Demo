// Public surface of the `capabilities` domain. Consumers import
// `@vynel/capabilities`.

export { CAPABILITY_CATALOG, findCapabilityById, defaultEnabledCapabilityIds } from './catalog.js'
export type { Capability, CapabilityId, CapabilityScope } from './capabilities-types.js'
export { listEnabledCapabilities } from './list-enabled-capabilities.js'
export { setCapabilityEnabled, type SetCapabilityEnabledInput } from './set-capability-enabled.js'
export {
  listCapabilityStatusForWorkspace,
  type CapabilityStatus,
} from './list-capability-status.js'
