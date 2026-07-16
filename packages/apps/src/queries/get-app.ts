// Read op — the id-ops' shared owner+workspace-bound fetch. Not-found,
// not-owned, and wrong-workspace all return the identical 404 (no
// enumeration leak; the workspace binding stops a same-user cross-workspace
// id from acting through another workspace's URL).

import { NotFoundError } from '@vynel/errors'
import * as appsRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { WorkspaceApp } from '../repositories/index.js'

export function getAppOrThrow(
  db: Database,
  input: { appId: string; userId: string; workspaceId: string },
): WorkspaceApp {
  const app = appsRepository.findAppById(db, input.appId)
  if (!app || app.userId !== input.userId || app.workspaceId !== input.workspaceId) {
    throw new NotFoundError('app', input.appId)
  }
  return app
}
