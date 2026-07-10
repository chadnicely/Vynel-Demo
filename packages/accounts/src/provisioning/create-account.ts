// Account creation — NEVER self-serve (cloud-api.md §3): callers are the
// admin fallback route today and the platform webhook handlers in M3. Sends
// the set-your-password invite as part of creation.

import { randomUUID } from 'node:crypto'
import { ConflictError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import { findAccountByEmail, insertAccount } from '@vynel/cloud-db/repositories/accounts'
import { issueSetPasswordLink, type SetPasswordLinkDeps } from '../credentials/set-password-links.js'

export interface CreateProvisionedAccountInput {
  readonly email: string
  readonly displayName: string
  readonly platformUserId?: string
}

// Postgres unique-violation (23505) — drizzle may wrap the driver error, so
// walk the cause chain.
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  while (current !== null && typeof current === 'object') {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export async function createProvisionedAccount(
  db: CloudDatabase,
  input: CreateProvisionedAccountInput,
  deps: SetPasswordLinkDeps,
): Promise<{ accountId: string }> {
  const existing = await findAccountByEmail(db, input.email)
  if (existing !== null) {
    throw new ConflictError(`An account already exists for ${input.email.toLowerCase()}.`)
  }
  let account
  try {
    account = await insertAccount(db, {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      ...(input.platformUserId !== undefined ? { platformUserId: input.platformUserId } : {}),
    })
  } catch (error) {
    // The find-then-insert race: a CONCURRENT duplicate (M3's retrying
    // webhooks) lands as a unique violation — surface the same 409, not a
    // 500 whose pg detail would leak the email into error logs.
    if (isUniqueViolation(error)) {
      throw new ConflictError(`An account already exists for ${input.email.toLowerCase()}.`)
    }
    throw error
  }
  await issueSetPasswordLink(db, { accountId: account.id, kind: 'invite' }, deps)
  return { accountId: account.id }
}
