// Barrel for the `users` domain schema. Re-exports both tables so the
// root `schema/index.ts` can aggregate by domain. Per
// `.claude/rules/structure-standard.md` "packages/db/src/schema/" — the
// `<domain>/index.ts` barrel is mandatory; root `schema/index.ts`
// re-exports every domain.

export * from './users.js'
export * from './user-preferences.js'
