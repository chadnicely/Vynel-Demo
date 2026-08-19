// The row → wire shape. The web store holds exactly this shape.

import type { ScopeCustomizationResponse } from '@vynel/contracts/customization/customization-http'
import type { ScopeCustomization } from '../schema/scope-customizations.js'

export function serializeScopeCustomization(row: ScopeCustomization): ScopeCustomizationResponse {
  return {
    scopeKey: row.scopeKey,
    colorSlot: row.accentColorSlot,
    customColor: row.accentCustomColor,
    personaColorSlot: row.personaColorSlot,
    personaCustomColor: row.personaCustomColor,
    personaImage: row.personaImage,
    workspaceImage: row.workspaceImage,
    groups: row.menuLayout.groups,
    entries: row.menuLayout.entries,
  }
}
