// The per-kind install manifest a `rule` catalog item carries in its
// (hub-opaque) `manifestJson` — parsed DESKTOP-side at browse/install time.
// A rule item holds no artifact: the manifest IS the install (config-is-truth,
// Chad 2026-08-02) — installing writes one `<itemId>.md` file into the
// scope's `.claude/rules/` folder (user → `~/.claude/rules/`, workspace →
// `<workspace>/.claude/rules/`), which Claude Code loads natively.

import { z } from 'zod'

export const RuleItemManifestSchema = z.object({
  /** The rule's markdown body — written under a provenance marker line so
   * hand-authored rule files are never confused with installed ones. */
  ruleMarkdown: z.string().min(1).max(64_000),
})

export type RuleItemManifest = z.infer<typeof RuleItemManifestSchema>

/** Lenient parse for catalog rows: browse must never throw on one bad row —
 * an unparsable rule manifest keeps the row off the shelf entirely
 * (no dead Get buttons). */
export function parseRuleItemManifest(manifestJson: string | null): RuleItemManifest | null {
  if (manifestJson === null) return null
  try {
    const result = RuleItemManifestSchema.safeParse(JSON.parse(manifestJson))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
