// The one "is the sealing key loaded" gate, shared by every route family
// that seals/opens credentials (ssh-servers, voice-providers). WHY
// ConflictError: @vynel/errors has no 503-mapping class and the taxonomy
// is deliberately closed — 409 "the server's current state can't take this
// request" is the closest existing fit.

import { ConflictError } from '@vynel/errors'
import type { Context } from 'hono'
import type { AppEnv } from './factory.js'

export function requireSealingMasterKey(c: Context<AppEnv>, featureLabel: string): string {
  const masterKey = c.var.sealingMasterKey
  if (masterKey === null) {
    throw new ConflictError(
      `${featureLabel} is unavailable: the encryption key is not loaded. Restart Vynel and try again.`,
    )
  }
  return masterKey
}
