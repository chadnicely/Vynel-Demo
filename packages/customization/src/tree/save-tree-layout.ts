// Save the sidebar tree's positions whole — one write per drop.

import crypto from 'node:crypto'
import type { Database } from '@vynel/db'
import type { TreeLayoutResponse } from '@vynel/contracts/customization/customization-http'
import { upsertTreeLayout } from '../repositories/tree-layouts.js'

export function saveTreeLayout(
  db: Database,
  input: { userId: string; layout: TreeLayoutResponse },
): TreeLayoutResponse {
  const now = new Date()
  return upsertTreeLayout(db, {
    id: crypto.randomUUID(),
    userId: input.userId,
    layout: input.layout,
    createdAt: now,
    updatedAt: now,
  }).layout
}
