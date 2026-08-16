// Test-support surface (the `@vynel/channels/test-support` precedent): the
// repo reads/writes another package's tests need to SEED and INSPECT rows
// without going through a live child process. Never imported by production
// code.

export {
  insertBackgroundProcess,
  findBackgroundProcessById,
} from './repositories/background-processes.js'
