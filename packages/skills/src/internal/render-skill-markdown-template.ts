// Pure template renderer for SKILL.md content. Replaces
// `{{settings.fieldName}}` placeholders with values from the
// resolved settings. Unknown placeholders (not in the settings
// map) ship as-is — see decisions D7 for the "fail visible, not
// silent" reasoning.
//
// Whitespace inside the braces is tolerated:
// `{{ settings.foo }}` matches `{{settings.foo}}` matches
// `{{settings.foo }}`.
//
// No I/O. Pure string → string transform.

import type { ResolvedSkillSettings } from '../settings/resolve-skill-settings.js'

const SETTINGS_PLACEHOLDER_PATTERN = /\{\{\s*settings\.([a-zA-Z0-9_]+)\s*\}\}/g

export function renderSkillMarkdownTemplate(
  template: string,
  settings: ResolvedSkillSettings,
): string {
  return template.replace(SETTINGS_PLACEHOLDER_PATTERN, (match, settingKey: string) => {
    const value = settings[settingKey]
    if (value === undefined) {
      // Unknown placeholder — leave intact. D7: typo in the
      // template ships visible misbehavior, which is easier to
      // debug than a silent install failure.
      return match
    }
    return String(value)
  })
}
