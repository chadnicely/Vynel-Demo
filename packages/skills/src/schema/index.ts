// Schema barrel for the `skills` domain. Re-exports every table
// file so `schema/index.ts` can aggregate by domain. Per
// `.claude/rules/structure-standard.md` "packages/skills/src/schema/".
export * from './installed-skills.js'
export * from './skill-settings.js'
