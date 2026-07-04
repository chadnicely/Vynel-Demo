// Generates the human-readable description stored in
// `approval_rules.description` at insert time. Pure function — input is
// the structured matcher, output is the user-facing string the rules
// panel renders.
//
// Stored at insert so the panel doesn't re-derive on every render; also
// preserves the description even if the labels-map below evolves
// (mirrors the actionKind-stored-at-insert precedent — D8).

import type { ApprovalRuleMatcher } from '../approvals-types.js'

const ACTION_KIND_LABELS: Record<string, string> = {
  'email-send': 'send emails',
  'file-write': 'write files',
  'file-edit': 'edit files',
  'file-delete': 'delete files',
  'calendar-write': 'modify the calendar',
  'shell-command': 'run shell commands',
  'external-action': 'take external actions',
  'memory-write': 'update memory',
  other: 'take this kind of action',
}

export function describeApprovalRule(matcher: ApprovalRuleMatcher): string {
  switch (matcher.kind) {
    case 'auto-approve-action-kind':
      return `Always allow ${ACTION_KIND_LABELS[matcher.actionKind] ?? matcher.actionKind} in this workspace`
    case 'auto-approve-tool-name':
      return `Always allow ${matcher.toolName} in this workspace`
  }
}
