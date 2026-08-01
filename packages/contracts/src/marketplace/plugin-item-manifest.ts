// The per-kind install manifest a `plugin` catalog item carries in its
// (hub-opaque) `manifestJson` — parsed DESKTOP-side at browse/install time.
// A plugin item holds no artifact of its own: install delegates to Claude
// Code's plugin system, which pulls from the named marketplace repo — the
// publisher's own distribution channel (the document-skills licensing
// stance: Anthropic→their-user via their tooling; Vynel orchestrates).

import { z } from 'zod'

export const PluginItemManifestSchema = z.object({
  /** GitHub `owner/repo` (or git URL) of the plugin marketplace to register. */
  marketplaceRepo: z.string().min(1).max(300),
  /** The marketplace's self-declared name (its marketplace.json `name`) —
   * the second half of Claude Code's `name@marketplace` registry key. */
  marketplaceName: z.string().min(1).max(120),
  pluginName: z.string().min(1).max(120),
})

export type PluginItemManifest = z.infer<typeof PluginItemManifestSchema>

/** Lenient parse for catalog rows: browse must never throw on one bad row —
 * an unparsable plugin manifest just renders as not-installable. */
export function parsePluginItemManifest(manifestJson: string | null): PluginItemManifest | null {
  if (manifestJson === null) return null
  try {
    const result = PluginItemManifestSchema.safeParse(JSON.parse(manifestJson))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
