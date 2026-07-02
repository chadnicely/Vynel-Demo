// Register an EXISTING directory the user selects as a workspace. In one
// transaction: dedup-guard, insert the DB row, ensure Vynel's `.vynel/`
// metadata dir, publish the workspace.created outbox event. Per
// `docs/blueprints/workspaces/blueprint.md §6.1` (existing-directory model,
// 2026-06-19) + decisions D3 (case-insensitive path dedup). Identity files are
// retired (A2) — workspace context now lives in structured memory.
//
// Phase 1 sync transaction callback per
// `.claude/memory/decisions/phase-1-sync-transactions.md` — every repo, fs, and
// cross-domain call inside is sync. The enclosing op stays `async` so the
// call-site shape survives the Phase 2 Postgres flip.

import path from 'node:path'
import { mkdirSync, accessSync, statSync, realpathSync, constants as fsConstants } from 'node:fs'
import * as workspacesRepository from '@vynel/db/repositories/workspaces'
import * as outboxRepository from '@vynel/db/repositories/_shared'
import { ConflictError, ValidationError } from '@vynel/errors'
import { withTransaction, type Database } from '@vynel/db'
import type { Workspace, WorkspaceKind } from '@vynel/db/repositories/workspaces'
import { WORKSPACE_CREATED_EVENT } from './workspaces-events.js'
import { deriveDefaultManagerName } from './manager-name.js'

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
}

// Structural logger shape — avoids the @vynel/logger dep at the core layer
// (matches the hard-delete-workspace precedent).
export type CreateWorkspaceDependencies = {
  readonly logger?: {
    info: (obj: object, msg: string) => void
  }
}

export async function createWorkspace(
  db: Database,
  input: CreateWorkspaceInput,
  deps: CreateWorkspaceDependencies = {},
): Promise<Workspace> {
  assertExistingWritableDirectory(input.directory)

  // Canonical absolute path — resolves symlinks and (on case-insensitive
  // volumes) the on-disk casing, so the dedup catches the same folder entered
  // with different casing / separators / trailing slash.
  const workspacePath = canonicalizePath(input.directory)
  const now = new Date()

  const createdWorkspace = withTransaction(db, (tx) => {
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
      // Auto-assign a default persona name on create (brain-tree Ch5) — deterministic by
      // id; renameable later. Pre-existing rows (null) resolve a default at read time.
      managerName: deriveDefaultManagerName(workspaceId),
      kind: input.kind ?? 'personal',
      path: workspacePath,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    })

    // Minimal scaffold: the user's existing folder layout is left untouched —
    // only Vynel's `.vynel/` metadata dir is created. Identity files are retired
    // (A2); workspace context now lives in structured memory.
    mkdirSync(path.join(workspacePath, '.vynel'), { recursive: true })

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
  })

  deps.logger?.info(
    { workspaceId: createdWorkspace.id, kind: createdWorkspace.kind, path: workspacePath },
    'workspace created',
  )

  return createdWorkspace
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
