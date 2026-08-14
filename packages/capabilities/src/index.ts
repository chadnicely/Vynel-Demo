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
export {
  SESSION_SURFACE_KINDS,
  TOOL_CARD_CLASSES,
  type EffectiveToolPolicies,
  type EffectiveToolPolicy,
  type SessionSurfaceKind,
  type ToolCardClass,
  type ToolCatalogEntry,
} from './tool-policy/tool-policy-types.js'
export {
  resolveEffectiveToolPolicies,
  TOOL_POLICY_UNGATED,
} from './tool-policy/resolve-effective-tool-policies.js'
export { applyToolPolicyDefaultsToCatalog } from './tool-policy/apply-tool-policy-defaults.js'
export {
  setToolPolicyOverride,
  type SetToolPolicyOverrideInput,
} from './tool-policy/set-tool-policy-override.js'
export { TOOL_POLICY_UPDATED, type ToolPolicyUpdatedPayload } from './tool-policy/tool-policy-events.js'
export { listToolPolicies, findToolPolicy, type ToolPolicyRow } from './repositories/tool-policies.js'
