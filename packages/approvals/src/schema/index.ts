// Schema barrel for the `approvals` domain — owned by `@vynel/approvals`. The
// two tables live in the feature package (the vertical-slice shape); the drizzle
// config + schema-parity guard pick them up from `packages/approvals/src/schema`.
// Per `.claude/rules/structure-standard.md`.
export * from './approval-rules.js'
export * from './approval-requests.js'
