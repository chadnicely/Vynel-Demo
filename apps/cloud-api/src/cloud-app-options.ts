// The DI shape `createCloudApp` and its route builders share. Everything the
// routes need arrives here — routes never touch process.env or module state.

import type { StructuralLogger } from '@vynel/logger'
import type { CloudDatabase } from '@vynel/cloud-db'
import type {
  AccessTokenIssuer,
  AccessTokenVerifier,
  AccountMailSender,
  EntitlementTokenIssuer,
} from '@vynel/accounts'
import type { ArtifactStore } from '@vynel/registry'
import type { UpstreamWatchJob } from './services/upstream-watch-job.js'

export interface CloudAppOptions {
  readonly db: CloudDatabase
  readonly logger: StructuralLogger
  readonly accessTokens: AccessTokenIssuer
  readonly accessTokenVerifier: AccessTokenVerifier
  readonly entitlements: EntitlementTokenIssuer
  readonly mail: AccountMailSender
  readonly artifactStore: ArtifactStore
  readonly linkBaseUrl: string
  readonly adminToken: string
  /** HMAC secret for /platform/webhooks; absent = that surface answers 503. */
  readonly platformWebhookSecret?: string
  /** The upstream-drift cron (server.ts starts it); absent = the
   * /admin/upstream-watch surface answers `configured: false` (tests, or a
   * deploy without the manifest). */
  readonly upstreamWatch?: UpstreamWatchJob
  /** Test seam — flows and rate-limit windows read time through this. */
  readonly now?: () => Date
}
