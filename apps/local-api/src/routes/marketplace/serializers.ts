// Response serializers for the `marketplace` routes. Pass-through
// under MINIMAL — the type already matches the wire shape; kept as a
// function so a future shape difference (e.g. publisherUrl becomes
// optional, displayName gets prefixed) is a one-place edit.
//
// Spec: blueprint §6 + coding.md §6.5. Filled in by /build-domain
// marketplace step 7.

import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'

export function serializeMarketplaceItem(item: MarketplaceItem): MarketplaceItem {
  return item
}
