// Schema barrel for the `memory` domain. Re-exports every table
// file so `schema/index.ts` can aggregate by domain. Per
// `.claude/rules/structure-standard.md` "packages/db/src/schema/".
export * from './memory-entries.js'
export * from './memory-entry-mentions.js'
export * from './memory-tags.js'
