// Barrel for the `users` domain repositories. Re-exports both repo files
// so consumers can `import { findUserById } from '@vynel/db/repositories/users'`
// per the `exports` map in `packages/db/package.json`. Created at scaffold
// time because the domain has 2 repos (the structure-standard "≥3 siblings"
// threshold for the barrel is exceeded by 1, but the package.json `exports`
// map points here so the barrel is required regardless).

export * from './users.js'
export * from './user-preferences.js'
