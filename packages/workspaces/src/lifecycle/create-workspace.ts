// Register an EXISTING directory the user selects as a workspace. Vynel's
// `.vynel/` metadata dir is ensured first (async, outside the transaction —
// see ensure-workspace-metadata-directory.ts), then in one transaction:
// dedup-guard, insert the DB row, publish the workspace.created outbox event. Per
// `docs/blueprints/workspaces/blueprint.md §6.1` (existing-directory model,
// 2026-06-19) + decisions D3 (case-insensitive path dedup). Identity files are
// retired (A2) — workspace context now lives in structured memory.
//
// Phase 1 sync transaction callback per
// `.claude/memory/decisions/phase-1-sync-transactions.md` — every repo, fs, and
// cross-domain call inside is sync. The enclosing op stays `async` so the
// call-site shape survives the Phase 2 Postgres flip.

import path from 'node:path'
import { accessSync, statSync, realpathSync, constants as fsConstants } from 'node:fs'
import { rm } from 'node:fs/promises'
import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { ConflictError, ValidationError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import type { Workspace, WorkspaceKind } from '@vynel/db/repositories/workspaces'
import { WORKSPACE_CREATED_EVENT } from '../workspaces-events.js'
import { ensureWorkspaceMetadataDirectory } from '../directory/ensure-workspace-metadata-directory.js'
import { getWorkspaceGroupForUserOrThrow } from '../groups/get-workspace-group-for-user.js'

export type CreateWorkspaceInput = {
  userId: string
  name: string
  /**
   * Optional — the user-facing kind picker was retired ("stop asking").
   * Defaults to 'personal' at insert. The column stays NOT NULL; the core
   * supplies the value (mirrors the id() "core supplies, no DB DEFAULT"
   * precedent — sidesteps the SQLite/Postgres DEFAULT mismatch + fails fast).
   */
  kind?: WorkspaceKind
  /** An EXISTING directory on disk to register as the workspace. */
  directory: string
  /** The menu-tree folder to be born into (owner-checked); omit for the tree root. */
  groupId?: string
  /** Stamp the project as already SET UP at birth — the wizard's scaffold and
   *  a clone pass `new Date()` (Vynel built and configured it, nothing to
   *  finish). Omitted for a pulled-in project, which starts under NEEDS SETUP. */
  setupCompletedAt?: Date
}

// Structural logger shape — avoids the @vynel/logger dep at the core layer
// (matches the hard-delete-workspace precedent).
export type CreateWorkspaceDependencies = {
  readonly logger?: {
    info: (obj: object, msg: string) => void
    warn?: (obj: object, msg: string) => void
  }
}

export async function createWorkspace(
  db: Database,
  input: CreateWorkspaceInput,
  deps: CreateWorkspaceDependencies = {},
): Promise<Workspace> {
  // The existing-directory guard runs FIRST: the ensure's recursive mkdir
  // would otherwise mint a missing folder (or throw raw ENOTDIR on a file)
  // instead of this ValidationError. Then `.vynel/` — async, before the
  // transaction (a filter driver stalling a sync mkdir inside it froze every
  // room; see ensure-workspace-metadata-directory.ts). A caller going through
  // `createWorkspaceWithin` directly does its own ensure first.
  assertExistingWritableDirectory(input.directory)
  const createdMetadataDirectory = await ensureWorkspaceMetadataDirectory(input.directory)

  let createdWorkspace: Workspace
  try {
    createdWorkspace = withTransaction(db, (tx) => createWorkspaceWithin(tx, input))
  } catch (error) {
    // A refused registration (dedup clash, foreign group) leaves the user's
    // folder as it was found — take back the dir THIS call created. A cleanup
    // failure is logged, never thrown over the real refusal (the scaffold's rule).
    if (createdMetadataDirectory !== null) {
      try {
        await rm(createdMetadataDirectory, { recursive: true, force: true })
      } catch (cleanupError) {
        deps.logger?.warn?.(
          { err: cleanupError, directory: input.directory },
          'could not take back the .vynel metadata dir',
        )
      }
    }
    throw error
  }

  deps.logger?.info(
    { workspaceId: createdWorkspace.id, kind: createdWorkspace.kind, path: createdWorkspace.path },
    'workspace created',
  )

  return createdWorkspace
}

/**
 * The body of `createWorkspace`, for a caller that co-commits more rows in
 * the SAME transaction (the wizard's scaffold adds the workspace's brief) —
 * invariant 5: one commit for the row, its event, and whatever rides with
 * it. Sync, like every Phase-1 transaction body.
 */
export function createWorkspaceWithin(tx: Database, input: CreateWorkspaceInput): Workspace {
  assertExistingWritableDirectory(input.directory)

  // Canonical absolute path — resolves symlinks and (on case-insensitive
  // volumes) the on-disk casing, so the dedup catches the same folder entered
  // with different casing / separators / trailing slash.
  const workspacePath = canonicalizePath(input.directory)
  const now = new Date()

  // A foreign or missing group 404s exactly like setWorkspaceGroup — before
  // anything is written.
  if (input.groupId !== undefined) {
    getWorkspaceGroupForUserOrThrow(tx, input.userId, input.groupId)
  }

  // LOAD-BEARING dedup: the existing-directory model has no "folder must not
  // already exist" guard, so this is the SOLE protection against adding the
  // same directory twice. Case-insensitive (D3); spans archived workspaces
  // (an archived workspace still owns its folder); unbounded indexed lookup.
  const clash = workspacesRepository.findWorkspaceByNormalizedPath(
    tx,
    input.userId,
    workspacePath,
  )
  if (clash) {
    throw new ConflictError(
      `${workspacePath} is already a workspace ("${clash.name}"). Pick a different directory.`,
    )
  }

  const workspaceId = crypto.randomUUID()
  const newWorkspace = workspacesRepository.insertWorkspace(tx, {
    id: workspaceId,
    userId: input.userId,
    name: input.name,
    // The manager persona defaults to the workspace's own name (Kafi,
    // 2026-08-19) — renameable later; a null row resolves the same way at read time.
    managerName: input.name,
    kind: input.kind ?? 'personal',
    path: workspacePath,
    groupId: input.groupId ?? null,
    isArchived: false,
    setupCompletedAt: input.setupCompletedAt ?? null,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })

  outboxRepository.insertOutboxEvent(tx, {
    id: crypto.randomUUID(),
    type: WORKSPACE_CREATED_EVENT,
    payload: {
      workspaceId: newWorkspace.id,
      userId: newWorkspace.userId,
      kind: newWorkspace.kind,
      name: newWorkspace.name,
      path: newWorkspace.path,
      createdAt: newWorkspace.createdAt.toISOString(),
    },
    createdAt: now,
  })

  return newWorkspace
}

function assertExistingWritableDirectory(directory: string): void {
  let stats
  try {
    stats = statSync(directory)
  } catch {
    throw new ValidationError(`Directory not found: ${directory}. Pick a folder that exists.`)
  }
  if (!stats.isDirectory()) {
    throw new ValidationError(`${directory} is not a directory. Pick a folder.`)
  }
  try {
    accessSync(directory, fsConstants.W_OK)
  } catch {
    throw new ValidationError(`${directory} is not writable. Pick a different folder.`)
  }
}

// realpath resolves symlinks + canonical casing; fall back to resolve() when the
// path no longer exists on disk (a stored workspace whose folder was moved).
function canonicalizePath(targetPath: string): string {
  try {
    return realpathSync(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}
