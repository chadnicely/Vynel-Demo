// Outbox event type constants + payload interfaces for the
// `skills` domain. Per D16: the lifecycle events —
// `skill.installed`, `skill.uninstalled`, `skill.updated`
// (claude-official arc, 2026-08-01), `skill.enabled-changed`,
// `skill.settings-updated`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra workspaces shipped. Atomicity is
// mandatory per data-standard.md "Cross-domain communication".
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so Phase
// 1.5 (onboarding workspace-context topup) + Phase 2 (sync) can
// subscribe without a producer-side migration. The cost is one
// outbox row per mutating op — a few KB per day in Phase 1.
//
// See `docs/blueprints/skills/blueprint.md §8` + `decisions.md`
// D16.

export const SKILL_INSTALLED = 'skill.installed' as const
export const SKILL_UNINSTALLED = 'skill.uninstalled' as const
export const SKILL_UPDATED = 'skill.updated' as const
export const SKILL_ENABLED_CHANGED = 'skill.enabled-changed' as const
export const SKILL_SETTINGS_UPDATED = 'skill.settings-updated' as const

export type SkillInstalledPayload = {
  installedSkillId: string
  userId: string
  workspaceId: string | null // null = user-scope
  skillId: string
  scope: 'user' | 'workspace'
  version: string
  source: 'verified-catalog' | 'marketplace' | 'external'
  installedAt: string
}

export type SkillUpdatedPayload = {
  installedSkillId: string
  userId: string
  workspaceId: string | null
  skillId: string
  scope: 'user' | 'workspace'
  previousVersion: string
  version: string
  updatedAt: string
}

export type SkillUninstalledPayload = {
  installedSkillId: string
  userId: string
  workspaceId: string | null
  skillId: string
  scope: 'user' | 'workspace'
  uninstalledAt: string
}

export type SkillEnabledChangedPayload = {
  installedSkillId: string
  userId: string
  workspaceId: string | null
  skillId: string
  isEnabled: boolean
  changedAt: string
}

export type SkillSettingsUpdatedPayload = {
  installedSkillId: string
  userId: string
  workspaceId: string | null
  skillId: string
  changedSettingKeys: string[]
  updatedAt: string
}
