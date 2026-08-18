// Manager persona naming (brain-tree Ch5). The derivation MOVED to
// `@vynel/contracts/workspaces/manager-name` (chat-mentions): the composer's
// @-persona picker derives the same names client-side, and contracts is the
// bundle-safe home for pure shared logic. Re-exported here so the domain's
// public surface (and every existing server import) is unchanged.

export {
  formatManagerLabel,
  hasDistinctManagerName,
  resolveManagerName,
} from '@vynel/contracts/workspaces/manager-name'
