// The DI shape `createCloudApp` and its route builders share. Everything the
// routes need arrives here — routes never touch process.env or module state.

import type { StructuralLogger } from '@vynel/logger'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { AccessTokenIssuer, AccessTokenVerifier, AccountMailSender } from '@vynel/accounts'

export interface CloudAppOptions {
  readonly db: CloudDatabase
  readonly logger: StructuralLogger
  readonly accessTokens: AccessTokenIssuer
  readonly accessTokenVerifier: AccessTokenVerifier
  readonly mail: AccountMailSender
  readonly linkBaseUrl: string
  readonly adminToken: string
  /** Test seam — flows and rate-limit windows read time through this. */
  readonly now?: () => Date
}
