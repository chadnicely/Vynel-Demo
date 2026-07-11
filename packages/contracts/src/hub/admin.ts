// Wire types for the hub's ADMIN surface (apps/cloud-api /admin/*) — shared by
// the hub's routes and the cloud-admin-web portal. Distinct from
// `./catalog.ts`: browse DTOs are tier-annotated for installers and show only
// published items; the admin view carries the full lifecycle (every status,
// every version) and never annotates `canInstall`.
// Consumers import the file directly (`@vynel/contracts/hub/admin`).

import type { HubItemKind, HubItemStatus, HubCatalogVersion, HubPublisherTier } from './catalog.js'
import type { HubTier } from './entitlements.js'

export type HubAccountRole = 'member' | 'admin'

export interface HubAdminCatalogItem {
  readonly itemId: string
  readonly kind: HubItemKind
  readonly status: HubItemStatus
  readonly publisherId: string
  readonly publisherName: string
  readonly publisherTier: HubPublisherTier
  readonly displayName: string
  readonly oneLineDescription: string
  readonly category: string
  readonly iconName: string
  readonly recommendedScope: 'user' | 'workspace' | null
  readonly minimumTier: HubTier
  readonly createdAt: string
  readonly updatedAt: string
  /** Every published version, newest first — the portal's version history. */
  readonly versions: HubCatalogVersion[]
}
