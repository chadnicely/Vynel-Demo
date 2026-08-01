import { describe, it, expect } from 'vitest'
import { CATALOG_ICON_NAMES, isCatalogIconName } from './catalog-icons.js'

describe('CATALOG_ICON_NAMES', () => {
  it('carries every icon name already published in the live catalog', () => {
    // The 9 names in hub rows before the picker existed, plus the seed
    // bundles' pen-line — removing any would monogram a shipped card.
    for (const legacy of [
      'mail',
      'inbox',
      'search',
      'file-text',
      'palette',
      'layout-template',
      'megaphone',
      'film',
      'sparkles',
      'pen-line',
    ]) {
      expect(isCatalogIconName(legacy)).toBe(true)
    }
  })

  it('is a deduplicated kebab-case list', () => {
    expect(new Set(CATALOG_ICON_NAMES).size).toBe(CATALOG_ICON_NAMES.length)
    for (const name of CATALOG_ICON_NAMES) {
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('rejects names outside the curated set', () => {
    expect(isCatalogIconName('swatch')).toBe(false)
    expect(isCatalogIconName('')).toBe(false)
  })
})
