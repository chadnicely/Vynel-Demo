// The `marketplace` leaf owns no tables (D1) — its wire types live in
// `@vynel/contracts/marketplace/*`. What lives HERE is the injection
// seam: the install-status of a catalog item is derived from the
// caller's installed skills, which the `skills` leaf owns. A leaf
// never imports a sibling leaf (invariant #2), so marketplace declares
// a STRUCTURAL view of the one skill shape it reads + a deps contract
// for the reader; the api layer (which may compose leaves) binds the
// real `listInstalledSkillsForUserAndWorkspace`. Mirrors the
// `FireScheduleDeps` / `ProcessInboundDeps` precedent.

import type { Database } from '@vynel/db'
import type { SkillScope } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'

// The exact five fields `annotateWithInstallStatus` reads off an
// installed-skill row. Field types match `@vynel/skills`'
// `InstalledSkillRow` (and `SkillScope` is the same contracts type
// `MarketplaceItemInstallStatus.scope` uses) so the injected reader's
// `InstalledSkillRow[]` return is assignable here without importing the
// skills leaf.
export type InstalledSkillView = {
  id: string
  skillId: string
  workspaceId: string | null
  scope: SkillScope
  versionInstalled: string
}

// The cross-leaf reads `listMarketplaceItems` / `getMarketplaceItem`
// need injected. `listInstalledSkills` returns the union of the
// caller's user-scope + workspace-scope installed skills.
export type MarketplaceDeps = {
  listInstalledSkills: (
    db: Database,
    input: { userId: string; workspaceId: string },
  ) => InstalledSkillView[]
}
