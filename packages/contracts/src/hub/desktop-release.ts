// Wire types for the hub's desktop-release update surface
// (apps/cloud-api GET /releases/desktop/:target/:arch/:currentVersion) —
// Tauri v2's dynamic-server updater protocol. Field names are snake_case
// where Tauri's client demands it (`pub_date`), so these types ARE the wire.
// The manifest shape mirrors the latest.json emitted by
// scripts/src/release/build-desktop.ts (`emitLatestManifest`).
// Consumers import the file directly (`@vynel/contracts/hub/desktop-release`).

/** Tauri's {{target}} placeholder values — the OS the updater runs on. */
export const DESKTOP_UPDATE_TARGETS = ['windows', 'linux', 'darwin'] as const
export type DesktopUpdateTarget = (typeof DESKTOP_UPDATE_TARGETS)[number]

/** Tauri's {{arch}} placeholder values. */
export const DESKTOP_UPDATE_ARCHES = ['x86_64', 'aarch64'] as const
export type DesktopUpdateArch = (typeof DESKTOP_UPDATE_ARCHES)[number]

/** One installer entry in latest.json, keyed by `<target>-<arch>`. */
export interface DesktopReleasePlatform {
  /** The minisign signature content for the installer artifact. */
  readonly signature: string
  /** Public download URL of the installer. */
  readonly url: string
}

/** The latest.json manifest the release build publishes to the releases repo. */
export interface DesktopReleaseManifest {
  readonly version: string
  readonly pub_date: string
  readonly platforms: Readonly<Record<string, DesktopReleasePlatform>>
}

/** The 200 body of the update check — exactly what the Tauri updater expects
 * when an update exists. Up to date (or no release for the platform) is a
 * bodyless 204 instead. */
export interface DesktopUpdateResponse {
  readonly version: string
  readonly pub_date: string
  readonly url: string
  readonly signature: string
}
