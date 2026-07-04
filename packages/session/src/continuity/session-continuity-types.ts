// Re-export of the `session-continuity` schema row types so consumers
// import them from `@vynel/session` rather than reaching into `@vynel/db`
// directly. Per `.claude/rules/structure-standard.md` (`<domain>-types.ts`).

// `StructuralLogger` is owned by `@vynel/logger` (the canonical type every
// core domain consumes) — re-exported here, not re-declared, per the
// one-home rule + the sibling-domain precedent (`agents-types.ts`).
export type { StructuralLogger } from '@vynel/logger'

export type {
  PrimarySessionRow,
  NewPrimarySessionRow,
} from '../repositories/index.js'
