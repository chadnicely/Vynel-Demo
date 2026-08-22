// @vynel/desktop-control — public surface.
//
// Exposes the desktop the AI agent operates, as an in-process MCP server it
// calls mid-turn: desktop notifications, listing open apps, reading an app's
// accessibility tree / pixels (`src/a11y/`), and — behind the default-off env
// flag — element and coordinate actions (`src/input/`). Every app-directed
// LOOKING is ungated; ACTING is gated by the turn's approved PLAN (`src/plan/`),
// which names every app it will touch and at which tier (read / click / full).
// Per-app grants were retired 2026-08-13 — they asked a second time for consent
// the plan already carries. Enforcement fails
// closed against the resolved target app. See README.md.

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
  sendDesktopToast,
  TOAST_TITLE_PREFIX,
  TOAST_TITLE_MAX_LENGTH,
  TOAST_MESSAGE_MAX_LENGTH,
} from './notifications/send-toast.js'
export type { SendDesktopToastInput } from './notifications/send-toast.js'

export {
  listOpenApps,
  snapshotApp,
  actOnApp,
  isAppNameMatch,
  actionRequiresValue,
  DESKTOP_ACTIONS,
} from './a11y/xa11y-adapter.js'
export { screenshotApp, findAppWindowBounds } from './a11y/screenshot-adapter.js'
export { screenshotDesktop } from './a11y/screenshot-desktop.js'
export type { DesktopScreenshot } from './a11y/screenshot-desktop.js'
export { setSystemVolume } from './system/volume.js'
export type { SystemVolumeState, SetSystemVolumeInput } from './system/volume.js'
export { listMonitors } from './a11y/monitors.js'
export type { MonitorInfo } from './a11y/monitors.js'
export { waitForCondition, WAIT_CONDITIONS } from './a11y/wait-for-condition.js'
export type { WaitConditionKind, WaitOutcome } from './a11y/wait-for-condition.js'
export type { AppScreenshot, WindowBounds } from './a11y/screenshot-adapter.js'
export {
  restoreIfMinimized,
  setWindowState,
  WINDOW_STATES,
  isWindowState,
} from './a11y/window-state.js'
export type { WindowState } from './a11y/window-state.js'

// Windows as ADDRESSABLE TARGETS — an app name is not a target (one app
// commonly owns several windows), and raising one is its own operation.
export {
  listDesktopWindows,
  selectWindow,
  topWindowForPid,
  findForegroundWindow,
  compareWindowPreference,
} from './a11y/desktop-windows.js'
export type { DesktopWindow, WindowMatch } from './a11y/desktop-windows.js'
export { focusWindowHandle, ensureForeground } from './a11y/window-focus.js'
export type { FocusDeps } from './a11y/window-focus.js'

export { actOnDesktop, DESKTOP_INPUT_ACTIONS } from './input/desktop-input.js'
export { readClipboard, writeClipboard } from './input/clipboard.js'
export type { ClipboardReadResult } from './input/clipboard.js'
export type {
  ActOnDesktopParams,
  ActOnDesktopResult,
  DesktopInputAction,
} from './input/desktop-input.js'
export type {
  OpenApp,
  SnapshotAppOptions,
  AppSnapshot,
  DesktopAction,
  ActOnAppResult,
  ActCandidate,
} from './a11y/xa11y-adapter.js'

export { buildDesktopMcpServer } from './mcp/build-desktop-mcp-server.js'
export type { BuildDesktopMcpServerInput } from './mcp/build-desktop-mcp-server.js'
export { desktopFeatureDescriptor } from './mcp/desktop-mcp-feature-descriptor.js'

export { listInstalledApps, matchInstalledApps } from './apps/installed-apps.js'
export type { InstalledApp } from './apps/installed-apps.js'
export { launchApp } from './apps/launch-app.js'
export type { LaunchAppResult } from './apps/launch-app.js'
export { openUrl, checkOpenableUrl, OPEN_URL_ALLOWED_SCHEMES } from './apps/open-url.js'

export { deriveDesktopPlanConsent } from './plan/desktop-plan-consent.js'
export { createDesktopPlanEnvelope } from './plan/desktop-plan-envelope.js'
export type {
  DesktopPlan,
  DesktopPlanApp,
  DesktopPlanEnvelope,
} from './plan/desktop-plan-envelope.js'

export {
  DESKTOP_ACCESS_TIERS,
  isDesktopAccessTier,
  tierAllows,
  normalizeDesktopAppKey,
} from './access/desktop-access-tiers.js'
export type { DesktopAccessTier, DesktopAccessAuthorizer } from './access/desktop-access-tiers.js'

export { resolveDesktopOs } from './platform.js'
export type { DesktopOs } from './platform.js'

// The durable record of what Claude did on the desktop — the access log's read
// side, and what "how far did that task get" is answered from.
export {
  recordDesktopAction,
  listDesktopActions,
  listDesktopActionsForSession,
  listRecentDesktopActionsForSession,
} from './repositories/desktop-actions.js'
export type { DesktopActionRow, RecordDesktopActionInput } from './repositories/desktop-actions.js'
export { desktopActions } from './schema/desktop-actions.js'
export type { DesktopActionOutcome } from './schema/desktop-actions.js'
