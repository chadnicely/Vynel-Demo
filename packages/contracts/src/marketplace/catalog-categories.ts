// Catalog categories are ADMIN-DEFINED and open-ended (Chad, 2026-08-02):
// the hub stores free strings, the desktop renders them verbatim, and the
// portal's category select derives its options from the live catalog. This
// file carries the two shared pieces: the baseline list the select always
// offers (so an empty catalog still has sensible options) and the one
// normalizer a new category passes through before it reaches the hub.

export const BASELINE_CATALOG_CATEGORIES = [
  'email',
  'documents',
  'calendar',
  'files',
  'research',
  'notes',
  'context',
  'creative',
  'communication',
] as const

/** Fold free text into the catalog's kebab-case category shape: lowercase,
 *  trimmed, word runs joined by single dashes, anything else dropped.
 *  Returns '' when nothing usable remains — callers treat that as invalid. */
export function normalizeCatalogCategory(raw: string): string {
  return raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}
