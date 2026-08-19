// Wire shapes for `/customizations` — everything the user arranges about
// their app: per-SCOPE looks (a workspace id or `global`) and the sidebar
// tree's positions. The web store holds these exact shapes; the API stores
// them (Kafi, 2026-08-19: icons, colours, menu layout and tree positions all
// live in the DB now, autosaved).

export const GLOBAL_SCOPE_KEY = 'global'

/** A menu group in a scope's sidebar menu (Customize → Menu). */
export interface MenuGroupLayout {
  id: string
  label: string
}

/** One section's place in a scope's sidebar menu. */
export interface MenuEntryLayout {
  sectionId: string
  groupId: string | null
  isHidden: boolean
}

/** Everything Customize holds for one scope. Colours are one choice each:
 *  a palette slot (`--ws-N`), a hand-picked `#rrggbb`, or neither (auto). */
export interface ScopeCustomizationResponse {
  scopeKey: string
  /** The workspace accent — icon, chips, rail. */
  colorSlot: number | null
  customColor: string | null
  /** The conversation (persona) icon's own colour. */
  personaColorSlot: number | null
  personaCustomColor: string | null
  /** Data-URL avatars; null = the defaults (Claude mark / monogram). */
  personaImage: string | null
  workspaceImage: string | null
  groups: MenuGroupLayout[]
  entries: MenuEntryLayout[]
}

/** Request body of `PUT /customizations/scopes/:scopeKey` — the whole scope, every time. */
export type SaveScopeCustomizationRequest = Omit<ScopeCustomizationResponse, 'scopeKey'>

/** The sidebar tree's positions: group ids top-to-bottom, workspace ids per list
 *  (a group id, or `root` for ungrouped). */
export interface TreeLayoutResponse {
  groups: string[]
  workspaces: Record<string, string[]>
}

export type SaveTreeLayoutRequest = TreeLayoutResponse

/** Response of `GET /customizations` — one read at boot. */
export interface CustomizationsResponse {
  scopes: ScopeCustomizationResponse[]
  treeLayout: TreeLayoutResponse | null
}
