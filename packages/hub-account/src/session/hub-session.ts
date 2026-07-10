// The desktop's hub session — ONE stateful service per daemon process (a
// closure store, shared by the /hub routes and the boot-check interval).
// `restore()` IS the boot-time account-status check (cloud-api.md §4):
//   online + good     -> refresh rotated, vault re-stored, signed-in
//   online + 401      -> session dead server-side -> vault cleared, signed-out
//   online + 403      -> account disabled -> vault cleared, LOCKED
//   hub unreachable   -> offline; the vault keeps the token, the cached
//                        identity carries the UI (grace semantics land in M3)
// No app enforcement yet — locking waits for M3 entitlements.

import { ForbiddenError, UnauthorizedError } from '@vynel/errors'
import type { StructuralLogger } from '@vynel/logger'
import type {
  HubDeviceDescription,
  HubDeviceView,
  HubLinkStatus,
  HubSessionResponse,
} from '@vynel/contracts/hub/hub-auth'
import type { HubClient } from '../client/hub-client.js'
import type { RefreshTokenVault } from '../vault/refresh-token-vault.js'

export interface HubSession {
  getStatus(): HubLinkStatus
  signIn(input: { email: string; password: string }): Promise<HubLinkStatus>
  signOut(): Promise<HubLinkStatus>
  restore(): Promise<HubLinkStatus>
  listDevices(): Promise<HubDeviceView[]>
  revokeDevice(deviceId: string): Promise<void>
}

export interface CreateHubSessionOptions {
  readonly client: HubClient
  readonly vault: RefreshTokenVault
  readonly device: HubDeviceDescription
  readonly logger: StructuralLogger
  readonly now?: () => Date
}

export function createHubSession(options: CreateHubSessionOptions): HubSession {
  const now = options.now ?? (() => new Date())
  let status: HubLinkStatus = { kind: 'signed-out' }
  let accessToken: string | null = null
  let identity: { email: string; displayName: string } | null = null

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

  function adoptSession(session: HubSessionResponse): HubLinkStatus {
    accessToken = session.accessToken
    identity = { email: session.email, displayName: session.displayName }
    status = {
      kind: 'signed-in',
      email: session.email,
      displayName: session.displayName,
      checkedAt: now().toISOString(),
    }
    return status
  }

  async function dropSession(nextStatus: HubLinkStatus): Promise<HubLinkStatus> {
    accessToken = null
    identity = null
    await options.vault.clear()
    status = nextStatus
    return status
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
      // Unreachable hub (or a 5xx): NOT a verdict on the account — keep the
      // token and carry the cached identity.
      options.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'hub unreachable during session restore — staying offline',
      )
      status = {
        kind: 'offline',
        email: identity?.email ?? null,
        displayName: identity?.displayName ?? null,
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
  }
}
