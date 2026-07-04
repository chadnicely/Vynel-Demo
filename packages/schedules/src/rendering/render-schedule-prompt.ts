// Core op — resolve {{user.x}} / {{workspace.x}} / {{now.x}} placeholders in
// a schedule's prompt template against the live user + workspace rows. sync
// (DB reads only). Unknown placeholders pass through unchanged (the
// skills-template discipline).
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.5` + coding.md §5.

import { findUserById } from '@vynel/db/repositories/users'
import { findWorkspaceById } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'

const SCHEDULE_PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

export function renderSchedulePrompt(
  db: Database,
  input: { promptTemplate: string; userId: string; workspaceId: string | null; now: Date },
): string {
  const user = findUserById(db, input.userId)
  // A GLOBAL schedule (null workspaceId) has no workspace row — its
  // `{{workspace.*}}` placeholders resolve to '' (the same fallback as a
  // missing workspace).
  const workspace = input.workspaceId !== null ? findWorkspaceById(db, input.workspaceId) : null

  const placeholderValues: Record<string, string> = {
    'user.displayName': user?.displayName ?? '',
    'workspace.name': workspace?.name ?? '',
    'workspace.kind': workspace?.kind ?? '',
    'workspace.kindReadable': workspace ? workspaceKindReadable(workspace.kind) : '',
    'now.iso': input.now.toISOString(),
    'now.dayOfWeek': formatDayOfWeek(input.now),
    'now.dateReadable': formatDateReadable(input.now),
  }

  return input.promptTemplate.replace(SCHEDULE_PLACEHOLDER_PATTERN, (_match, key: string) => {
    return placeholderValues[key] ?? `{{${key}}}`
  })
}

// WorkspaceKind = 'small-business' | 'personal' | 'project' | 'custom'
// (verified on disk — there is NO 'client-engagement').
function workspaceKindReadable(kind: string): string {
  switch (kind) {
    case 'small-business':
      return 'business'
    case 'personal':
      return 'personal workspace'
    case 'project':
      return 'project'
    case 'custom':
      return 'workspace'
    default:
      return kind
  }
}

function formatDayOfWeek(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

function formatDateReadable(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
