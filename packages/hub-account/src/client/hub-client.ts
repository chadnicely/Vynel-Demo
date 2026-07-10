// The desktop's HTTP client for the hub's /auth surface. Typed against
// `@vynel/contracts/hub/hub-auth` — the same shapes the hub's routes serve.
// Error convention: an HTTP error response maps to the matching VynelError
// subclass (the hub sends { code, message }); a NETWORK failure (hub
// unreachable, timeout) throws HubUnreachableError (503) — routes surface it
// as "check your connection", and the session layer's restore() treats
// anything that isn't a 401/403 verdict as offline.

import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
  VynelError,
} from '@vynel/errors'
import type {
  HubDevicesResponse,
  HubErrorResponse,
  HubRefreshRequest,
  HubSessionResponse,
  HubSignInRequest,
} from '@vynel/contracts/hub/hub-auth'
import type { HubCatalogResponse } from '@vynel/contracts/hub/catalog'

export interface HubClient {
  signIn(request: HubSignInRequest): Promise<HubSessionResponse>
  refresh(request: HubRefreshRequest): Promise<HubSessionResponse>
  signOut(request: HubRefreshRequest): Promise<void>
  listDevices(accessToken: string): Promise<HubDevicesResponse>
  revokeDevice(accessToken: string, deviceId: string): Promise<void>
  getCatalog(accessToken: string): Promise<HubCatalogResponse>
  /** The raw artifact bytes for a catalog item version (tier-gated
   * server-side; a 403 surfaces as ForbiddenError). */
  downloadArtifact(accessToken: string, itemId: string, version: string): Promise<Buffer>
}

class HubRequestFailedError extends VynelError {
  readonly code = 'hub_request_failed'
  readonly httpStatus = 502
}

/** Network-level failure (DNS, refused, timeout) — the hub never answered.
 * 503 so a route surfaces "check your connection", never a 500; the session
 * layer's restore() reads it as OFFLINE (neither 401 nor 403 = no verdict). */
export class HubUnreachableError extends VynelError {
  readonly code = 'hub_unreachable'
  readonly httpStatus = 503
}

const REQUEST_TIMEOUT_MS = 15_000

async function toVynelError(response: Response): Promise<VynelError> {
  let message = `The hub answered ${response.status}.`
  try {
    const body = (await response.json()) as HubErrorResponse
    if (typeof body.message === 'string' && body.message !== '') message = body.message
  } catch {
    // Non-JSON error body — keep the status message.
  }
  switch (response.status) {
    case 400:
      return new ValidationError(message)
    case 401:
      return new UnauthorizedError(message)
    case 403:
      return new ForbiddenError(message)
    case 404:
      return new NotFoundError('hub resource')
    case 429:
      return new RateLimitedError(message)
    default:
      return new HubRequestFailedError(message)
  }
}

export function createHubClient(options: {
  readonly baseUrl: string
  readonly fetchFn?: typeof fetch
}): HubClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const fetchFn = options.fetchFn ?? fetch

  async function request(
    path: string,
    init: { method: string; body?: unknown; accessToken?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = {}
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.accessToken !== undefined) headers['authorization'] = `Bearer ${init.accessToken}`
    let response: Response
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        // Bound a black-holed connection — 15s is generous for auth calls.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      })
    } catch (error) {
      throw new HubUnreachableError("Can't reach the Vynel hub — check your connection.", {
        cause: error,
      })
    }
    if (!response.ok) throw await toVynelError(response)
    return response
  }

  return {
    async signIn(body) {
      const response = await request('/auth/sign-in', { method: 'POST', body })
      return (await response.json()) as HubSessionResponse
    },
    async refresh(body) {
      const response = await request('/auth/refresh', { method: 'POST', body })
      return (await response.json()) as HubSessionResponse
    },
    async signOut(body) {
      await request('/auth/sign-out', { method: 'POST', body })
    },
    async listDevices(accessToken) {
      const response = await request('/auth/devices', { method: 'GET', accessToken })
      return (await response.json()) as HubDevicesResponse
    },
    async revokeDevice(accessToken, deviceId) {
      await request(`/auth/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        accessToken,
      })
    },
    async getCatalog(accessToken) {
      const response = await request('/catalog', { method: 'GET', accessToken })
      return (await response.json()) as HubCatalogResponse
    },
    async downloadArtifact(accessToken, itemId, version) {
      const response = await request(
        `/catalog/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(version)}/download`,
        { method: 'GET', accessToken },
      )
      return Buffer.from(await response.arrayBuffer())
    },
  }
}
