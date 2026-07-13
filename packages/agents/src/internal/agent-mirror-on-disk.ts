// The agent transparency mirror's disk operations — write, remove,
// sync. The file (`.claude/agents/<slug>.md`) is DERIVED state: the DB
// row stays the source of truth, so removal and sync are best-effort
// (logged warn on failure, never a thrown error), while the install
// path's write is load-bearing and throws (disk-first-then-tx, the
// `install-cloud-skill.ts` D8 ordering).
//
// Removal AND write are MARKER-CHECKED: only a file containing the
// "Managed by Vynel" header is ever deleted or overwritten. A
// workspace's `.claude/agents/` may hold the user's own hand-authored
// agent files — Vynel never destroys a file it did not write.

import path from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import type { Database } from '@vynel/db'
import { ConflictError } from '@vynel/errors'
import type { AgentRow, StructuralLogger } from '../agents-types.js'
import {
  AGENT_MIRROR_MANAGED_MARKER,
  renderAgentMirrorMarkdown,
} from './render-agent-mirror-markdown.js'
import {
  resolveAgentMirrorPath,
  type AgentMirrorLocator,
} from './resolve-agent-mirror-path.js'

// Load-bearing write (install + enable paths): a failure propagates so
// the caller can abort or log per its own contract. Marker-guarded like
// removal: an existing marker-less file is the user's own hand-authored
// agent and is never overwritten — the install path lets the
// `ConflictError` abort the install; the sync path downgrades it to a
// warn + skip (safe: while the row is enabled, the programmatic
// definition shadows the file).
export async function writeAgentMirrorOnDisk(
  mirrorPath: string,
  markdown: string,
): Promise<void> {
  let existingContent: string | null = null
  try {
    existingContent = await readFile(mirrorPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (existingContent !== null && !existingContent.includes(AGENT_MIRROR_MANAGED_MARKER)) {
    throw new ConflictError(
      `An agent file you authored yourself already exists at ${mirrorPath} — ` +
        'rename or remove it first, then retry.',
    )
  }
  await mkdir(path.dirname(mirrorPath), { recursive: true })
  await writeFile(mirrorPath, markdown, 'utf8')
}

// Best-effort, marker-checked removal. Idempotent: a missing file is a
// silent no-op; a marker-less (hand-authored) file is left in place.
export async function removeAgentMirrorOnDisk(
  db: Database,
  locator: AgentMirrorLocator,
  logger?: StructuralLogger,
): Promise<void> {
  try {
    const mirrorPath = resolveAgentMirrorPath(db, locator)
    if (mirrorPath === null) {
      // Workspace row gone — the mirror lived inside that directory.
      return
    }
    let content: string
    try {
      content = await readFile(mirrorPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (!content.includes(AGENT_MIRROR_MANAGED_MARKER)) {
      logger?.info(
        { slug: locator.slug, mirrorPath },
        'agent file on disk is not a Vynel mirror — left in place',
      )
      return
    }
    await rm(mirrorPath, { force: true })
  } catch (error) {
    // The row is truth; a stranded mirror is a transparency defect, not
    // a state defect. Surface it and move on.
    logger?.warn(
      { error, slug: locator.slug },
      'agent mirror removal failed — remove .claude/agents file by hand if it lingers',
    )
  }
}

// Converges the mirror with the row: present exactly while the agent is
// enabled and live. Best-effort — used after update commits, where the
// DB state must win regardless of disk health.
export async function syncAgentMirrorOnDisk(
  db: Database,
  agent: AgentRow,
  logger?: StructuralLogger,
): Promise<void> {
  const locator: AgentMirrorLocator = {
    scope: agent.scope,
    workspaceId: agent.workspaceId,
    slug: agent.slug,
  }
  if (!agent.enabled || agent.deletedAt !== null) {
    await removeAgentMirrorOnDisk(db, locator, logger)
    return
  }
  try {
    const mirrorPath = resolveAgentMirrorPath(db, locator)
    if (mirrorPath === null) {
      logger?.warn(
        { slug: agent.slug, workspaceId: agent.workspaceId },
        'agent mirror skipped — workspace row not found for path resolution',
      )
      return
    }
    await writeAgentMirrorOnDisk(mirrorPath, renderAgentMirrorMarkdown(agent))
  } catch (error) {
    if (error instanceof ConflictError) {
      // A hand-authored file holds the path. Skipping is safe: while the
      // row is enabled its programmatic definition shadows the file.
      logger?.warn(
        { slug: agent.slug },
        'agent mirror write skipped — a hand-authored agent file holds the path and is left in place',
      )
      return
    }
    logger?.warn(
      { error, slug: agent.slug },
      'agent mirror write failed — the DB row stays the source of truth',
    )
  }
}
