// Outbox vocabulary for the tool-policy concern. Payloads carry ids + the
// change shape, never row bodies (outbox convention).

export const TOOL_POLICY_UPDATED = 'tool-policy.updated'

export type ToolPolicyUpdatedPayload = {
  userId: string
  toolName: string
  /** false = the save normalized to "reset to default" (row absent). */
  hasOverride: boolean
  updatedAt: string
}
