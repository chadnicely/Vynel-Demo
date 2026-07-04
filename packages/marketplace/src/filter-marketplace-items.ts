// Pure helper — filters and sorts marketplace items in memory.
// Pipeline order is fixed: annotate happens upstream (D6), then
// filter, then sort. No I/O.
//
// Search uses `String.prototype.includes` (case-insensitive) over
// `displayName + oneLineDescription` (D5). Queries under 2 chars
// no-op so the user can type without thrashing.
//
// Spec: blueprint §5.2 + coding.md §1.3.

import type {
  MarketplaceFilterInput,
  MarketplaceItem,
  MarketplaceSortKey,
} from '@vynel/contracts/marketplace/marketplace-item'

export function filterAndSortMarketplaceItems(input: MarketplaceFilterInput): MarketplaceItem[] {
  let result = input.items
  if (input.category) {
    result = result.filter((i) => i.category === input.category)
  }
  if (input.publisherTier) {
    result = result.filter((i) => i.publisherTier === input.publisherTier)
  }
  if (input.installState) {
    const targetState = input.installState
    result = result.filter((i) => matchesInstallState(i, targetState))
  }
  if (input.searchQuery && input.searchQuery.trim().length >= 2) {
    const q = input.searchQuery.toLowerCase()
    result = result.filter(
      (i) =>
        i.displayName.toLowerCase().includes(q) || i.oneLineDescription.toLowerCase().includes(q),
    )
  }
  return sortMarketplaceItems(result, input.sortBy ?? 'recommended')
}

function matchesInstallState(
  item: MarketplaceItem,
  installState: 'installed' | 'not-installed',
): boolean {
  if (installState === 'installed') return item.installStatus.kind === 'installed'
  return item.installStatus.kind === 'not-installed'
}

function sortMarketplaceItems(
  items: MarketplaceItem[],
  sortBy: MarketplaceSortKey,
): MarketplaceItem[] {
  // Sort a copy — never mutate the caller's array.
  const sorted = [...items]
  switch (sortBy) {
    case 'recommended':
    case 'name-asc':
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName))
      break
    case 'newest':
      sorted.sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))
      break
  }
  return sorted
}
