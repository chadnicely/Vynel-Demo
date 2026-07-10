// Issue set-password links (invite + reset) and confirm them. Both kinds end
// the same way: the user proves email control, sets a password, and every
// existing session dies (a credential change invalidates old sessions).

import { randomUUID } from 'node:crypto'
import { UnauthorizedError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import {
  findAccountByEmail,
  getAccountByIdOrThrow,
  updateAccountPasswordHash,
} from '@vynel/cloud-db/repositories/accounts'
import type { AccountActionTokenKind } from '../schema/account-action-tokens.js'
import { generateOpaqueSecret, hashOpaqueSecret } from '../tokens/opaque-secret.js'
import { hashPassword } from '../passwords/password-hash.js'
import {
  expireOutstandingActionTokens,
  findActionTokenByHash,
  insertActionToken,
  markActionTokenUsed,
} from '../repositories/action-tokens/index.js'
import { revokeAllRefreshTokensForAccount } from '../repositories/refresh-tokens/index.js'
import type { AccountMailSender } from '../mail/account-mail-sender.js'

const INVITE_TTL_HOURS = 7 * 24
const RESET_TTL_MINUTES = 30

export interface SetPasswordLinkDeps {
  readonly mail: AccountMailSender
  /** Where the link lands, e.g. https://hub.vynel.app — path is /set-password. */
  readonly linkBaseUrl: string
  readonly now?: () => Date
}

/** Send a set-password link to a KNOWN account (platform provisioning /
 * admin create). Kills any outstanding link of the same kind first. */
export async function issueSetPasswordLink(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly kind: AccountActionTokenKind },
  deps: SetPasswordLinkDeps,
): Promise<void> {
  const now = deps.now?.() ?? new Date()
  const account = await getAccountByIdOrThrow(db, input.accountId)
  const secret = generateOpaqueSecret()
  const ttlMs =
    input.kind === 'invite' ? INVITE_TTL_HOURS * 60 * 60 * 1000 : RESET_TTL_MINUTES * 60 * 1000
  const expiresAt = new Date(now.getTime() + ttlMs)

  await expireOutstandingActionTokens(db, { accountId: account.id, kind: input.kind, now })
  await insertActionToken(db, {
    id: randomUUID(),
    accountId: account.id,
    kind: input.kind,
    tokenHash: hashOpaqueSecret(secret),
    expiresAt,
  })
  await deps.mail.sendSetPasswordLink({
    email: account.email,
    displayName: account.displayName,
    kind: input.kind,
    link: `${deps.linkBaseUrl}/set-password?token=${secret}`,
    expiresAt,
  })
}

/** The public "forgot password" entry. ALWAYS resolves void — an unknown
 * email is silently ignored (no account enumeration through this route). */
export async function requestPasswordReset(
  db: CloudDatabase,
  input: { readonly email: string },
  deps: SetPasswordLinkDeps,
): Promise<void> {
  const account = await findAccountByEmail(db, input.email)
  if (account === null || account.status !== 'active') return
  await issueSetPasswordLink(db, { accountId: account.id, kind: 'password-reset' }, deps)
}

/** Consume a link: set the password, burn the token, kill every session. */
export async function confirmSetPassword(
  db: CloudDatabase,
  input: { readonly token: string; readonly newPassword: string },
  deps: { readonly now?: () => Date },
): Promise<{ accountId: string }> {
  const now = deps.now?.() ?? new Date()
  const invalidLink = new UnauthorizedError(
    'This link is invalid or has expired — request a new one from the sign-in screen.',
  )
  const row = await findActionTokenByHash(db, hashOpaqueSecret(input.token))
  if (row === null || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
    throw invalidLink
  }
  const passwordHash = await hashPassword(input.newPassword)
  // One transaction: claim the single-use token (0 rows = a concurrent
  // confirm won — this one loses), set the password, kill every session. A
  // crash can't leave a burned link without the password set, or a changed
  // password with old sessions alive.
  await db.transaction(async (tx) => {
    const claimed = await markActionTokenUsed(tx, { actionTokenId: row.id, usedAt: now })
    if (claimed === 0) throw invalidLink
    await updateAccountPasswordHash(tx, { accountId: row.accountId, passwordHash })
    await revokeAllRefreshTokensForAccount(tx, { accountId: row.accountId, revokedAt: now })
  })
  return { accountId: row.accountId }
}
