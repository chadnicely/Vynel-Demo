// Which items a marketplace SURFACE lists (Chad's rule): the GLOBAL
// marketplace shows user + both items (and installs at user scope); each
// workspace marketplace shows workspace + both items. Pure — used by both
// read paths (`listMarketplaceItems` / `getMarketplaceItem`) so browse and
// lookup can never disagree about what a surface contains.

import type {
  MarketplaceItem,
  MarketplaceSurface,
} from '@vynel/contracts/marketplace/marketplace-item'

export function isItemVisibleOnSurface(
  item: MarketplaceItem,
  surface: MarketplaceSurface,
): boolean {
  if (item.scope === 'both') return true
  return surface === 'global' ? item.scope === 'user' : item.scope === 'workspace'
}
