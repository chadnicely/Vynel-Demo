// HTTP shapes for the `workspaces` domain. The serialized response
// shape `apps/local-api/src/routes/workspaces/index.ts` returns from every
// workspace route (GET, POST, PATCH, archive, unarchive). Single
// source of truth: `apps/local-api` types `serializeWorkspaceForResponse`'s
// return as `WorkspaceResponse`; `apps/web` casts SDK responses to
// it (the routes carry no response schema in the OpenAPI spec, so
// the SDK can't infer the response type itself — letterman uses the
// same cast-from-contracts pattern). Promoted to `@vynel/contracts`
// on the `apps/web` second-consumer trigger per
// `coding-standard.md` "Zod schemas" + the
// `apps-web-foundation-design` decision.

import type { WorkspaceKind } from './workspace-kind-bundles.js'
import type { WorkspaceSetStatus } from './workspace-status.js'

export interface WorkspaceResponse {
  id: string
  userId: string
  name: string
  /** The workspace manager's persona name (brain-tree Ch5) — "Mark is handling vynel".
   *  Null on pre-persona rows (the UI resolves a default for display). */
  managerName: string | null
  kind: WorkspaceKind
  path: string
  isArchived: boolean
  /** Continue-mode toggle (Slice 2) — true = the landing conversation follows
   *  the root + swaps invisibly; false = classic per-topic sessions. */
  continueEnabled: boolean
  /** Menu-tree folder membership (workspace redesign Arc 2b) — the owning
   *  `WorkspaceGroupResponse.id`, or null at the tree root. */
  groupId: string | null
  /** The assistant-set status (redesign Arc 5b) — null when nothing set.
   *  Effective status derives client-side (see workspace-status.ts). */
  status: WorkspaceSetStatus | null
  statusNote: string | null
  /** ISO-8601; null when nothing set. */
  statusSetAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
  /** ISO-8601 */
  lastAccessedAt: string
}

/** A subdirectory in the folder-picker listing (`GET /workspaces/directories`). */
export interface DirectoryEntryResponse {
  name: string
  /** Absolute path. */
  path: string
}

/** Response shape of `GET /workspaces/directories` — the workspace folder picker. */
export interface DirectoryListingResponse {
  /** The canonical absolute path being listed. */
  path: string
  /** The parent directory for "up" navigation, or null at the filesystem root. */
  parent: string | null
  entries: DirectoryEntryResponse[]
  /** Drive/volume roots the user can jump to (Windows drive letters; POSIX root). */
  drives: string[]
}

/** A menu-tree folder (workspace redesign Arc 2b) — the serialized shape
 *  every `/workspaces/groups` route returns. Membership is
 *  `WorkspaceResponse.groupId`. */
export interface WorkspaceGroupResponse {
  id: string
  userId: string
  name: string
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}
