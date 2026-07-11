export {
  insertAccount,
  findAccountByEmail,
  findAccountById,
  findAccountByPlatformUserId,
  getAccountByIdOrThrow,
  updateAccountPasswordHash,
  updateAccountDisplayName,
  updateAccountEmail,
  setAccountStatus,
  setAccountTier,
  setAccountRole,
  type InsertAccountInput,
} from './accounts-repository.js'
export type { AccountRole, AccountStatus } from '../../schema/accounts/accounts.js'
