import { describe, it, expect } from 'vitest'
import {
  BASELINE_CATALOG_CATEGORIES,
  normalizeCatalogCategory,
} from './catalog-categories.js'

describe('normalizeCatalogCategory', () => {
  it('kebab-cases free text', () => {
    expect(normalizeCatalogCategory('Data Science')).toBe('data-science')
    expect(normalizeCatalogCategory('  DevOps / Infra  ')).toBe('devops-infra')
    expect(normalizeCatalogCategory('already-kebab')).toBe('already-kebab')
  })

  it('collapses separator runs and trims dangling dashes', () => {
    expect(normalizeCatalogCategory('--a__b--')).toBe('a-b')
    expect(normalizeCatalogCategory('a   b')).toBe('a-b')
  })

  it('returns empty when nothing usable remains', () => {
    expect(normalizeCatalogCategory('   ')).toBe('')
    expect(normalizeCatalogCategory('***')).toBe('')
  })

  it('the baseline list is already normalized (self-consistent)', () => {
    for (const category of BASELINE_CATALOG_CATEGORIES) {
      expect(normalizeCatalogCategory(category)).toBe(category)
    }
  })
})
