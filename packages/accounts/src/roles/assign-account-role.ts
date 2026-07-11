// Grant or revoke the admin role. Bootstrap path: the FIRST admin is assigned
// via the static-token door (`CLOUD_ADMIN_TOKEN`), after which that person can
// manage roles from the portal itself.

import { NotFoundError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import {
  findAccountById,
  setAccountRole,
  type AccountRole,
} from '@vynel/cloud-db/repositories/accounts'

export async function assignAccountRole(
  db: CloudDatabase,
  input: { readonly accountId: string; readonly role: AccountRole },
): Promise<void> {
  const account = await findAccountById(db, input.accountId)
  if (account === null) throw new NotFoundError('account', input.accountId)
  await setAccountRole(db, input)
}
