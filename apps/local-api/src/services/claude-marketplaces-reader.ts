// The user-registered Claude marketplaces reader — composes the provider's
// two disk reads (known_marketplaces.json + each clone's marketplace.json)
// into the marketplace leaf's structural view. Injectable via
// `CreateAppOptions.claudeMarketplacesReader` (the plugin-reader precedent:
// a statically-bound reader would make every unmocked route test read the
// developer's real ~/.claude/plugins).

import { listKnownClaudeMarketplaces, readClaudeMarketplaceCatalog } from '@vynel/providers'
import type { ClaudeMarketplaceSourceView } from '@vynel/marketplace'

export function listClaudeMarketplaceSources(homeDir?: string): ClaudeMarketplaceSourceView[] {
  return listKnownClaudeMarketplaces(homeDir).map((known) => {
    const catalog =
      known.installLocation !== null
        ? readClaudeMarketplaceCatalog(known.marketplaceName, known.installLocation)
        : null
    // A registered-but-unreadable marketplace (clone missing, malformed
    // catalog) still lists as a SOURCE — with no plugins it contributes
    // nothing to the shelf, but the management list must show it so the
    // user can remove or re-add it.
    return {
      marketplaceName: known.marketplaceName,
      sourceUrl: known.sourceUrl,
      ownerName: catalog?.ownerName ?? null,
      plugins: catalog?.plugins ?? [],
    }
  })
}
