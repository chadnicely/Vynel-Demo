// Schema barrel for the `agents` domain. Re-exports every table file
// so `schema/index.ts` can aggregate by domain. Per
// `.claude/rules/structure-standard.md` "packages/db/src/schema/".
export * from './agents.js'
export * from './agent-skills.js'
