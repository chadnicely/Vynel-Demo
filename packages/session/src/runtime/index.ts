// The `@vynel/session/runtime` subpath — the session-execution surface, kept
// SEPARATE from the package barrel (`../index.ts`, which re-exports only the
// web-safe mode model). Importing the runtime pulls `@vynel/chat` /
// `@vynel/orchestration` / `@vynel/db` / `@vynel/providers`, so it must never
// reach the `apps/web` bundle — see
// `./session-types.ts` for why the barrel stays web-safe.

export type { SessionSink } from './session-types.js'
export {
  runGlobalRootTurnCore,
  type RunGlobalRootTurnCoreDeps,
  type RunGlobalRootTurnCoreInput,
  type GlobalRootTarget,
} from './run-global-root-turn-core.js'
