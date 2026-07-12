// TDD-first tests for the filter + sort pure helper. Per blueprint
// §13.1 + coding.md §8.1. Pure function — no DB.

import { describe, it, expect } from 'vitest'
import { filterAndSortMarketplaceItems } from './filter-marketplace-items.js'
import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'

function makeItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    itemId: 'a',
    kind: 'skill',
    skillId: 'a',
    publisherTier: 'verified',
    publisherName: 'Vynel Team',
    publisherUrl: null,
    displayName: 'Alpha',
    oneLineDescription: 'First test item',
    category: 'email',
    iconName: 'mail',
    version: '1.0.0',
    releasedAt: '2026-01-01T00:00:00Z',
    recommendedScope: 'user',
    scope: 'both',
    isOfficial: true,
    installStatus: { kind: 'not-installed' },
    ...overrides,
  }
}

describe('filterAndSortMarketplaceItems', () => {
  describe('filters', () => {
    it('returns the input unchanged when no filters are passed (default sort)', () => {
      const items = [makeItem({ itemId: 'a', skillId: 'a' })]
      const result = filterAndSortMarketplaceItems({ items })
      expect(result).toHaveLength(1)
      expect(result[0]?.itemId).toBe('a')
    })

    it('narrows by category', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a', category: 'email' }),
        makeItem({ itemId: 'b', skillId: 'b', category: 'documents' }),
      ]
      const result = filterAndSortMarketplaceItems({ items, category: 'email' })
      expect(result.map((i) => i.itemId)).toEqual(['a'])
    })

    it('narrows by publisherTier', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a', publisherTier: 'verified' }),
        makeItem({ itemId: 'b', skillId: 'b', publisherTier: 'community' }),
      ]
      const result = filterAndSortMarketplaceItems({ items, publisherTier: 'verified' })
      expect(result.map((i) => i.itemId)).toEqual(['a'])
    })

    it('narrows by installState=installed', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a' }),
        makeItem({
          itemId: 'b',
          skillId: 'b',
          installStatus: {
            kind: 'installed',
            scope: 'user',
            installedId: 'x',
            versionInstalled: '1.0.0',
          },
        }),
      ]
      const result = filterAndSortMarketplaceItems({ items, installState: 'installed' })
      expect(result.map((i) => i.itemId)).toEqual(['b'])
    })

    it('narrows by installState=not-installed', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a' }),
        makeItem({
          itemId: 'b',
          skillId: 'b',
          installStatus: {
            kind: 'installed',
            scope: 'user',
            installedId: 'x',
            versionInstalled: '1.0.0',
          },
        }),
      ]
      const result = filterAndSortMarketplaceItems({ items, installState: 'not-installed' })
      expect(result.map((i) => i.itemId)).toEqual(['a'])
    })

    it('combines filters (category + publisherTier)', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a', category: 'email', publisherTier: 'verified' }),
        makeItem({ itemId: 'b', skillId: 'b', category: 'email', publisherTier: 'community' }),
        makeItem({ itemId: 'c', skillId: 'c', category: 'documents', publisherTier: 'verified' }),
      ]
      const result = filterAndSortMarketplaceItems({
        items,
        category: 'email',
        publisherTier: 'verified',
      })
      expect(result.map((i) => i.itemId)).toEqual(['a'])
    })
  })

  describe('search', () => {
    it('returns all items when searchQuery is empty', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a' }),
        makeItem({ itemId: 'b', skillId: 'b' }),
      ]
      const result = filterAndSortMarketplaceItems({ items, searchQuery: '' })
      expect(result).toHaveLength(2)
    })

    it('returns all items when searchQuery is under 2 chars', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a', displayName: 'Alpha' }),
        makeItem({ itemId: 'b', skillId: 'b', displayName: 'Beta' }),
      ]
      const result = filterAndSortMarketplaceItems({ items, searchQuery: 'a' })
      expect(result).toHaveLength(2)
    })

    it('matches case-insensitive on displayName', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a', displayName: 'Email Drafter' }),
        makeItem({ itemId: 'b', skillId: 'b', displayName: 'Note Taker' }),
      ]
      const result = filterAndSortMarketplaceItems({ items, searchQuery: 'EMAIL' })
      expect(result.map((i) => i.itemId)).toEqual(['a'])
    })

    it('matches case-insensitive on oneLineDescription', () => {
      const items = [
        makeItem({
          itemId: 'a',
          skillId: 'a',
          displayName: 'Foo',
          oneLineDescription: 'Draft contextual email replies',
        }),
        makeItem({
          itemId: 'b',
          skillId: 'b',
          displayName: 'Bar',
          oneLineDescription: 'Manage calendar events',
        }),
      ]
      const result = filterAndSortMarketplaceItems({ items, searchQuery: 'email' })
      expect(result.map((i) => i.itemId)).toEqual(['a'])
    })
  })

  describe('sort', () => {
    it('recommended sort = alphabetical by displayName', () => {
      const items = [
        makeItem({ itemId: 'b', skillId: 'b', displayName: 'Beta' }),
        makeItem({ itemId: 'a', skillId: 'a', displayName: 'Alpha' }),
      ]
      const result = filterAndSortMarketplaceItems({ items, sortBy: 'recommended' })
      expect(result.map((i) => i.itemId)).toEqual(['a', 'b'])
    })

    it('name-asc sort = alphabetical by displayName', () => {
      const items = [
        makeItem({ itemId: 'c', skillId: 'c', displayName: 'Charlie' }),
        makeItem({ itemId: 'a', skillId: 'a', displayName: 'Alpha' }),
        makeItem({ itemId: 'b', skillId: 'b', displayName: 'Beta' }),
      ]
      const result = filterAndSortMarketplaceItems({ items, sortBy: 'name-asc' })
      expect(result.map((i) => i.itemId)).toEqual(['a', 'b', 'c'])
    })

    it('newest sort = most recent releasedAt first', () => {
      const items = [
        makeItem({ itemId: 'a', skillId: 'a', releasedAt: '2025-01-01T00:00:00Z' }),
        makeItem({ itemId: 'b', skillId: 'b', releasedAt: '2026-06-01T00:00:00Z' }),
        makeItem({ itemId: 'c', skillId: 'c', releasedAt: '2026-01-01T00:00:00Z' }),
      ]
      const result = filterAndSortMarketplaceItems({ items, sortBy: 'newest' })
      expect(result.map((i) => i.itemId)).toEqual(['b', 'c', 'a'])
    })

    it('does not mutate the input array', () => {
      const items = [
        makeItem({ itemId: 'b', skillId: 'b', displayName: 'Beta' }),
        makeItem({ itemId: 'a', skillId: 'a', displayName: 'Alpha' }),
      ]
      const before = items.map((i) => i.itemId)
      filterAndSortMarketplaceItems({ items, sortBy: 'name-asc' })
      expect(items.map((i) => i.itemId)).toEqual(before)
    })
  })
})
