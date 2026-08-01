// Response serializers for the `skills` routes — convert DB
// rows + catalog definitions to JSON-safe shapes (Date → ISO
// string; readonly arrays → arrays).
//
// Per blueprint §6.1 — API-internal response shape (single
// consumer = apps/web). Promote to `@vynel/contracts/skills/*`
// on the SECOND consumer.

import type {
  InstalledSkillRow,
  ResolvedSkillSettings,
  InstalledSkillWithDefinitionAndSettings,
} from '@vynel/skills'
import type {
  VerifiedSkillDefinition,
  SkillSettingSchema,
} from '@vynel/contracts/skills/verified-skills/verified-skill-definition'

export function serializeSkillSettingSchema(schema: SkillSettingSchema): unknown {
  const out: Record<string, unknown> = {
    settingKey: schema.settingKey,
    displayLabel: schema.displayLabel,
    description: schema.description,
    type: schema.type,
    defaultValue: schema.defaultValue,
  }
  if (schema.enumValues !== undefined) out.enumValues = [...schema.enumValues]
  if (schema.validationConstraints !== undefined) {
    out.validationConstraints = { ...schema.validationConstraints }
  }
  return out
}

export function serializeVerifiedSkill(definition: VerifiedSkillDefinition): unknown {
  return {
    skillId: definition.skillId,
    displayName: definition.displayName,
    oneLineDescription: definition.oneLineDescription,
    category: definition.category,
    iconName: definition.iconName,
    version: definition.version,
    recommendedScope: definition.recommendedScope,
    isSystemInstalled: definition.isSystemInstalled,
    settingsSchema: definition.settingsSchema.map(serializeSkillSettingSchema),
  }
}

export function serializeInstalledSkillRow(row: InstalledSkillRow): unknown {
  return {
    id: row.id,
    skillId: row.skillId,
    scope: row.scope,
    workspaceId: row.workspaceId,
    installedFromSource: row.installedFromSource,
    versionInstalled: row.versionInstalled,
    installHealth: row.installHealth,
    installHealthMessage: row.installHealthMessage,
    installedAt: row.installedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function serializeInstalledSkillWithDefinition(
  joined: InstalledSkillWithDefinitionAndSettings,
): unknown {
  return {
    ...(serializeInstalledSkillRow(joined.installedSkill) as Record<string, unknown>),
    definition: joined.definition ? serializeVerifiedSkill(joined.definition) : null,
    resolvedSettings: serializeResolvedSettings(joined.resolvedSettings),
  }
}

export function serializeResolvedSettings(
  settings: ResolvedSkillSettings,
): Record<string, unknown> {
  return { ...settings }
}
