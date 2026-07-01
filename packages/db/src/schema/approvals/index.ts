// Schema barrel for the `approvals` domain. Re-exports every table file so
// `schema/index.ts` can aggregate by domain. Per
// `.claude/rules/structure-standard.md` "packages/db/src/schema/".
export * from './approval-rules.js'
export * from './approval-requests.js'
