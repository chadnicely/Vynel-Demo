// Public surface of the `spawned` concern — sessions the root creates as a
// tool (session-library Slice ④). Consumers import `@vynel/session/spawned`.

export { createSpawnedSession } from './create-spawned-session.js'
export type {
  CreateSpawnedSessionInput,
  CreateSpawnedSessionResult,
} from './create-spawned-session.js'
export { findSpawnedSessionBySegmentId } from './find-spawned-session-by-segment.js'
export type { FindSpawnedSessionBySegmentIdInput } from './find-spawned-session-by-segment.js'
