// Save one scope's customization whole (autosave writes the entire scope on
// every change — no partial updates, so the row IS the customization). The
// route's zod schema owns the wire shape; this op guards what a schema can't
// express: colours are real `#rrggbb`, images are `data:image/…` URLs of a
// sane size (the app's avatar resizer keeps them tiny), one colour choice
// each. Typed errors → 400 at the boundary.

import crypto from 'node:crypto'
import { ValidationError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type {
  SaveScopeCustomizationRequest,
  ScopeCustomizationResponse,
} from '@vynel/contracts/customization/customization-http'
import { upsertScopeCustomization } from '../repositories/scope-customizations.js'
import { serializeScopeCustomization } from './serialize-scope-customization.js'

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i
// The avatar resizer emits a few KB; 512 KB is generous headroom, not a budget.
const IMAGE_MAX_CHARS = 512 * 1024

export type SaveScopeCustomizationInput = {
  userId: string
  scopeKey: string
  customization: SaveScopeCustomizationRequest
}

export function saveScopeCustomization(
  db: Database,
  input: SaveScopeCustomizationInput,
): ScopeCustomizationResponse {
  const c = input.customization
  assertColour('customColor', c.customColor)
  assertColour('personaCustomColor', c.personaCustomColor)
  assertImage('personaImage', c.personaImage)
  assertImage('workspaceImage', c.workspaceImage)
  if (c.colorSlot !== null && c.customColor !== null) {
    throw new ValidationError('Pick a palette colour or a custom colour for the accent, not both.')
  }
  if (c.personaColorSlot !== null && c.personaCustomColor !== null) {
    throw new ValidationError('Pick a palette colour or a custom colour for the persona icon, not both.')
  }

  const now = new Date()
  const saved = upsertScopeCustomization(db, {
    id: crypto.randomUUID(),
    userId: input.userId,
    scopeKey: input.scopeKey,
    accentColorSlot: c.colorSlot,
    accentCustomColor: c.customColor?.toLowerCase() ?? null,
    personaColorSlot: c.personaColorSlot,
    personaCustomColor: c.personaCustomColor?.toLowerCase() ?? null,
    personaImage: c.personaImage,
    workspaceImage: c.workspaceImage,
    menuLayout: { groups: c.groups, entries: c.entries },
    createdAt: now,
    updatedAt: now,
  })
  return serializeScopeCustomization(saved)
}

function assertColour(field: string, value: string | null) {
  if (value !== null && !HEX_COLOR.test(value)) {
    throw new ValidationError(`${field} must be a #rrggbb colour.`)
  }
}

function assertImage(field: string, value: string | null) {
  if (value === null) return
  if (!IMAGE_DATA_URL.test(value)) {
    throw new ValidationError(`${field} must be a data:image/… URL.`)
  }
  if (value.length > IMAGE_MAX_CHARS) {
    throw new ValidationError(`${field} is too large — pick a smaller image.`)
  }
}
