// The desktop's hub session — ONE stateful service per daemon process (a
// closure store, shared by the /hub routes and the boot-check interval).
// `restore()` IS the boot-time account-status check (cloud-api.md §4):
//   online + good     -> refresh rotated, entitlement re-issued, signed-in
//   online + 401      -> session dead server-side -> vaults cleared, signed-out
//   online + 403      -> account disabled -> vaults cleared, LOCKED
//   hub unreachable   -> offline; the STORED entitlement (verified against
//                        the pinned key) carries identity + tier + features
//                        through the ~7-day grace window
// Tier gating reads getEntitlement(); the /hub routes read getStatus().

import { ForbiddenError, UnauthorizedError } from '@vynel/errors'
import type { StructuralLogger } from '@vynel/logger'
import type {
  HubDeviceDescription,
  HubDeviceView,
  HubLinkStatus,
  HubSessionResponse,
} from '@vynel/contracts/hub/hub-auth'
import type { HubEntitlementClaims } from '@vynel/contracts/hub/entitlements'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import type { HubClient } from '../client/hub-client.js'
import type { RefreshTokenVault } from '../vault/refresh-token-vault.js'
import type { EntitlementVerifier } from '../tokens/entitlement-verifier.js'

export interface HubSession {
  getStatus(): HubLinkStatus
  /** The verified claims backing the current status — null when signed out,
   * locked, or past the offline grace window. The daemon's feature gate
   * reads this. */
  getEntitlement(): HubEntitlementClaims | null
  signIn(input: { email: string; password: string }): Promise<HubLinkStatus>
  signOut(): Promise<HubLinkStatus>
  restore(): Promise<HubLinkStatus>
  listDevices(): Promise<HubDeviceView[]>
  revokeDevice(deviceId: string): Promise<void>
  /** The hub's cloud catalog, ridden on the access token (restore-and-retry
   * on a stale token). Throws UnauthorizedError when not signed in. */
  fetchCatalog(): Promise<readonly HubCatalogItem[]>
}

export interface CreateHubSessionOptions {
  readonly client: HubClient
  readonly vault: RefreshTokenVault
  readonly entitlementVault: RefreshTokenVault
  readonly entitlements: EntitlementVerifier
  readonly device: HubDeviceDescription
  readonly logger: StructuralLogger
  readonly now?: () => Date
}

export function createHubSession(options: CreateHubSessionOptions): HubSession {
  const now = options.now ?? (() => new Date())
  let status: HubLinkStatus = { kind: 'signed-out' }
  let accessToken: string | null = null
  let entitlement: HubEntitlementClaims | null = null

  // Every vault-mutating op runs strictly serialized: a daily restore() in
  // flight while the user signs out (or a boot restore racing a fresh
  // sign-in) must not interleave — the loser would re-store a rotated token
  // after the vault was cleared, or overwrite a fresher secret and leak a
  // duplicate device family.
  let operationQueue: Promise<void> = Promise.resolve()
  function serialized<T>(op: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(op)
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function adoptSession(session: HubSessionResponse): Promise<HubLinkStatus> {
    accessToken = session.accessToken
    try {
      entitlement = await options.entitlements.verify(session.entitlementToken)
      await options.entitlementVault.store(session.entitlementToken)
    } catch {
      // A hub/desktop key mismatch must not block sign-in — the account is
      // proven; only the tier proof is missing (features read as none).
      entitlement = null
      options.logger.warn(
        {},
        'entitlement token failed verification — check VYNEL_HUB_PUBLIC_KEY matches the hub keypair',
      )
    }
    status = {
      kind: 'signed-in',
      email: session.email,
      displayName: session.displayName,
      checkedAt: now().toISOString(),
      // null (not 'basic'/[]) when unproven: the UI reads null as "don't
      // gate", matching the daemon's permissive-without-entitlement gate.
      tier: entitlement?.tier ?? null,
      features: entitlement ? [...entitlement.features] : null,
    }
    return status
  }

  async function dropSession(nextStatus: HubLinkStatus): Promise<HubLinkStatus> {
    accessToken = null
    entitlement = null
    await options.vault.clear()
    await options.entitlementVault.clear()
    status = nextStatus
    return status
  }

  /** The stored entitlement, if still inside its grace window. */
  async function loadStoredEntitlement(): Promise<HubEntitlementClaims | null> {
    const token = await options.entitlementVault.load()
    if (token === null) return null
    try {
      return await options.entitlements.verify(token)
    } catch {
      return null
    }
  }

  async function restoreNow(): Promise<HubLinkStatus> {
    const refreshToken = await options.vault.load()
    if (refreshToken === null) {
      return dropSession({ kind: 'signed-out' })
    }
    try {
      const session = await options.client.refresh({ refreshToken })
      await options.vault.store(session.refreshToken)
      return adoptSession(session)
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return dropSession({ kind: 'signed-out' })
      }
      if (error instanceof ForbiddenError) {
        return dropSession({ kind: 'locked', message: error.message })
      }
      // Unreachable hub (or a 5xx): NOT a verdict on the account — the
      // stored entitlement carries identity + features through the grace
      // window (or reads as none once expired).
      options.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'hub unreachable during session restore — staying offline',
      )
      entitlement = await loadStoredEntitlement()
      status = {
        kind: 'offline',
        email: entitlement?.email ?? null,
        displayName: entitlement?.displayName ?? null,
        tier: entitlement?.tier ?? null,
        features: entitlement?.features ?? [],
      }
      return status
    }
  }

  const restore = (): Promise<HubLinkStatus> => serialized(restoreNow)

  /** Devices calls ride the short-lived access token; a 401 means it aged
   * out — restore once (rotates + refreshes it), then retry. */
  async function withAccessToken<T>(run: (token: string) => Promise<T>): Promise<T> {
    if (accessToken === null) await restore()
    if (accessToken === null) throw new UnauthorizedError('Sign in to the hub first.')
    try {
      return await run(accessToken)
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error
      await restore()
      if (accessToken === null) throw error
      return run(accessToken)
    }
  }

  return {
    getStatus() {
      return status
    },
    getEntitlement() {
      return entitlement
    },
    signIn(input) {
      return serialized(async () => {
        const session = await options.client.signIn({ ...input, device: options.device })
        await options.vault.store(session.refreshToken)
        return adoptSession(session)
      })
    },
    signOut() {
      return serialized(async () => {
        const refreshToken = await options.vault.load()
        if (refreshToken !== null) {
          try {
            await options.client.signOut({ refreshToken })
          } catch (error) {
            // Local sign-out must not be blocked by a failing hub; the
            // server-side family dies at its next contact or via devices.
            options.logger.warn(
              { error: error instanceof Error ? error.message : String(error) },
              'hub sign-out call failed — clearing locally',
            )
          }
        }
        return dropSession({ kind: 'signed-out' })
      })
    },
    restore,
    async listDevices() {
      const response = await withAccessToken((token) => options.client.listDevices(token))
      return [...response.devices]
    },
    async revokeDevice(deviceId) {
      await withAccessToken((token) => options.client.revokeDevice(token, deviceId))
    },
    async fetchCatalog() {
      const response = await withAccessToken((token) => options.client.getCatalog(token))
      return response.items
    },
  }
}
