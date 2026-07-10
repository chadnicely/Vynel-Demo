// Wire types for the HUB's auth surface (apps/cloud-api /auth/*) — shared by
// the hub's routes AND the desktop's hub client (`@vynel/hub-account`) so the
// two sides cannot drift: the whole point of co-locating the cloud second
// system in this repo (docs/module-notes/cloud-api.md §2). Zod stays at each
// app's parse boundary; these are types only. Consumers import the file
// directly (`@vynel/contracts/hub/hub-auth`); no barrel.

export interface HubDeviceDescription {
  readonly deviceName: string
  readonly devicePlatform: string
  readonly appVersion: string
}

export interface HubSignInRequest {
  readonly email: string
  readonly password: string
  readonly device: HubDeviceDescription
}

export interface HubRefreshRequest {
  readonly refreshToken: string
}

/** Sign-in and refresh both answer the full session envelope. */
export interface HubSessionResponse {
  readonly accountId: string
  readonly email: string
  readonly displayName: string
  readonly accessToken: string
  readonly accessTokenExpiresAt: string
  readonly refreshToken: string
  /** Signed tier+features proof (~7d exp) — the desktop verifies it against
   * the pinned public key and keeps it for offline boots (§4). */
  readonly entitlementToken: string
}

export interface HubDeviceView {
  readonly id: string
  readonly deviceName: string
  readonly devicePlatform: string
  readonly appVersion: string
  readonly lastUsedAt: string
  readonly expiresAt: string
}

export interface HubDevicesResponse {
  readonly devices: readonly HubDeviceView[]
}

export interface HubErrorResponse {
  readonly code: string
  readonly message: string
}

/**
 * The DESKTOP's view of its hub link (the daemon's GET /hub/session).
 * `offline` keeps the cached identity: the app works through the entitlement
 * grace window without connectivity (cloud-api.md §4); `locked` is the
 * revocation signal (disabled account). No enforcement until M3 entitlements.
 */
export type HubLinkStatus =
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'signed-out' }
  | {
      readonly kind: 'signed-in'
      readonly email: string
      readonly displayName: string
      readonly checkedAt: string
      /** null when the entitlement token failed verification (a hub/desktop
       * key mismatch): the account is proven, the tier isn't — the UI must
       * not gate on an unproven tier, and the daemon stays permissive. */
      readonly tier: string | null
      readonly features: readonly string[] | null
    }
  | { readonly kind: 'locked'; readonly message: string }
  | {
      readonly kind: 'offline'
      readonly email: string | null
      readonly displayName: string | null
      /** From the stored entitlement while it's inside the grace window;
       * null once it expired (features then read as none). */
      readonly tier: string | null
      readonly features: readonly string[]
    }
