// Everything the user arranged, in one read — the boot fetch.

import type { Database } from '@vynel/db'
import type { CustomizationsResponse } from '@vynel/contracts/customization/customization-http'
import { listScopeCustomizationsForUser } from '../repositories/scope-customizations.js'
import { findTreeLayoutForUser } from '../repositories/tree-layouts.js'
import { serializeScopeCustomization } from './serialize-scope-customization.js'

export function listCustomizations(db: Database, input: { userId: string }): CustomizationsResponse {
  return {
    scopes: listScopeCustomizationsForUser(db, input.userId).map(serializeScopeCustomization),
    treeLayout: findTreeLayoutForUser(db, input.userId)?.layout ?? null,
  }
}
