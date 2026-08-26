// The shared predicate lives in the contracts kernel (`@vynel/contracts/fs/
// safe-file-stem`) because the agents leaf lists and writes `.claude/`
// files too, and leaves never import each other. Re-exported here so the
// rules and commands doors keep one short import.

export { isSafeFileStem, MAX_FILE_STEM_LENGTH } from '@vynel/contracts/fs/safe-file-stem'
