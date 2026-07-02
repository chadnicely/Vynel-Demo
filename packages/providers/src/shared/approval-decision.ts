// `ApprovalDecision` — the discriminated union for a tool-approval outcome.
// Discriminated on `kind`. See `docs/blueprints/providers/blueprint.md §7.1`.

export type ApprovalDecision =
  // Proceed. `updatedInput` lets the user edit the tool inputs before it runs
  // (e.g. edit the email before sending). `rememberRule` records an
  // "always allow this kind of action" rule for the provider.
  | { kind: 'approved'; updatedInput?: unknown; rememberRule?: string }
  // The tool call is refused. `reason` is shown to the agent so it can adjust.
  | { kind: 'denied'; reason: string }
  // No decision arrived in the timeout window — equivalent to a synthetic deny.
  | { kind: 'timed-out' }
  // The session was interrupted while waiting for the decision.
  | { kind: 'cancelled' }
