// @vynel/desktop-control — public surface.
//
// Exposes the desktop the AI agent operates, as an in-process MCP server it
// calls mid-turn. Phase 1 = OBSERVATION (all read-only): desktop notifications,
// listing open apps, and reading an app's accessibility tree (`src/a11y/`, via
// xa11y). Desktop ACTIONS (act / click / type) arrive in a later increment,
// each gated through the approval card. See README.md.

export { createDesktopNotificationListener } from './notifications/listener.js'
export type {
  DesktopNotificationListener,
  CreateDesktopNotificationListenerOptions,
} from './notifications/listener.js'
export type {
  DesktopNotification,
  DesktopNotificationReader,
} from './notifications/desktop-notification.js'

export {
  listOpenApps,
  snapshotApp,
  actOnApp,
  isAppNameMatch,
  actionRequiresValue,
  DESKTOP_ACTIONS,
} from './a11y/xa11y-adapter.js'
export type {
  OpenApp,
  SnapshotAppOptions,
  DesktopAction,
  ActOnAppResult,
  ActCandidate,
} from './a11y/xa11y-adapter.js'

export { buildDesktopMcpServer } from './mcp/build-desktop-mcp-server.js'
export type { BuildDesktopMcpServerInput } from './mcp/build-desktop-mcp-server.js'
export { desktopFeatureDescriptor } from './mcp/desktop-mcp-feature-descriptor.js'

export { resolveDesktopOs } from './platform.js'
export type { DesktopOs } from './platform.js'
