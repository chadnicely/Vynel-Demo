// The rule-matching engine — pure function over (rules, toolName,
// actionKind, toolInput). No I/O, no side effects. The caller fetches
// rules (workspace-scoped today; user-global in Phase 1.5) and passes
// them in so the engine stays testable in isolation.
//
// Phase 1 ships TWO rule kinds (D6 revised + D17). The
// `auto-approve-tool-name-with-args` variant + its field-picker UI land
// in Phase 1.5 together.

import type { ActionKind, ApprovalRule, ApprovalRuleMatcher } from '../approvals-types.js'

export type EvaluateApprovalRulesInput = {
  toolName: string
  actionKind: ActionKind
  toolInput: unknown
  workspaceRules: readonly ApprovalRule[]
}

export type RuleMatch = { rule: ApprovalRule }

export function evaluateApprovalRules(input: EvaluateApprovalRulesInput): RuleMatch | null {
  for (const rule of input.workspaceRules) {
    if (!rule.isEnabled) continue
    if (matches(rule.matcher, input.toolName, input.actionKind)) {
      return { rule }
    }
  }
  return null
}

function matches(matcher: ApprovalRuleMatcher, toolName: string, actionKind: ActionKind): boolean {
  switch (matcher.kind) {
    case 'auto-approve-action-kind':
      return matcher.actionKind === actionKind
    case 'auto-approve-tool-name':
      return matcher.toolName === toolName
  }
}
