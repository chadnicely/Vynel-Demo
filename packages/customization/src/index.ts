// Public surface of `@vynel/customization` — how the user arranged their app:
// per-scope looks (colours, avatars, menu layout) and the sidebar tree's
// positions. Consumers reach the package only through this barrel; schema and
// repositories are internal.

export { listCustomizations } from './scopes/list-customizations.js'
export { saveScopeCustomization, type SaveScopeCustomizationInput } from './scopes/save-scope-customization.js'
export { saveTreeLayout } from './tree/save-tree-layout.js'
