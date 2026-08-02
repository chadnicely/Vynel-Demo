// Serializer for the `rules` routes — the package's file listing + the
// surface's scope tag, field-for-field with `RuleRowSchema`.

import type { RuleFileForScope } from '@vynel/skills'
import type { z } from 'zod'
import type { RuleRowSchema } from './schemas.js'

export type RuleRow = z.infer<typeof RuleRowSchema>

export function serializeRuleFile(
  rule: RuleFileForScope,
  scope: 'user' | 'workspace',
): RuleRow {
  return {
    ruleId: rule.ruleId,
    fileName: rule.fileName,
    title: rule.title,
    content: rule.content,
    scope,
    marketplace: rule.marketplace,
  }
}
