// The curated icon vocabulary for marketplace catalog items — the ONE home
// both sides consume: the admin portal's icon picker offers exactly these
// names, and the desktop card's static lucide map covers exactly these names
// (typed `Record<CatalogIconName, Component>` so drift fails the compile).
// Every name exists in lucide-vue-next@0.468 (verified against the package's
// icon manifest). The hub keeps storing iconName as a free string — legacy
// rows outside this list render as the item's monogram, never break.

export const CATALOG_ICON_NAMES = [
  'book-open',
  'bookmark',
  'bot',
  'briefcase',
  'calendar',
  'chart-bar',
  'chart-pie',
  'circle-check',
  'clipboard',
  'clock',
  'cloud',
  'code',
  'database',
  'file-text',
  'film',
  'folder',
  'globe',
  'graduation-cap',
  'image',
  'inbox',
  'key',
  'languages',
  'layout-template',
  'lightbulb',
  'link',
  'list-checks',
  'mail',
  'map',
  'megaphone',
  'message-square',
  'newspaper',
  'notebook',
  'package',
  'palette',
  'pen-line',
  'presentation',
  'rocket',
  'search',
  'settings',
  'shield',
  'sparkles',
  'star',
  'table',
  'terminal',
  'users',
  'video',
  'wrench',
  'zap',
] as const

export type CatalogIconName = (typeof CATALOG_ICON_NAMES)[number]

export function isCatalogIconName(raw: string): raw is CatalogIconName {
  return (CATALOG_ICON_NAMES as readonly string[]).includes(raw)
}
