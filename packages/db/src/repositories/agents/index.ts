// Public barrel for the `agents` domain's repository layer. Required by
// `@vynel/db`'s exports map (`./repositories/*` →
// `./src/repositories/*/index.ts`), so the barrel is mandatory even
// though the structure-standard says barrels are optional under ≥3
// siblings — the exports-map requirement overrides the guidance (same
// precedent as every other domain).

export * from './agents.js'
export * from './agent-skills.js'
