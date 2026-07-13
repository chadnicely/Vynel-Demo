// The shared choreography behind BOTH marketplace-provenance installs
// (`installCloudAgent` + `installCuratedAgent`): duplicate pre-check ->
// transparency mirror on disk -> `createAgent` row. Package-internal —
// not on the public surface; user-created agents (`createAgent` via
// `POST /agents`) deliberately get NO mirror (recorded follow-up in
// `docs/module-notes/marketplace-kinds.md` "Disk visibility").
//
// Ordering (skills' D8, `install-cloud-skill.ts`):
//   1. Duplicate slug+scope pre-check BEFORE any disk touch — a
//      conflicting install must never overwrite the LIVE agent's mirror
//      (createAgent's own check stays as the in-tx backstop).
//   2. Mirror write FIRST — a disk failure aborts the install with no
//      row and no orphan. The write is marker-guarded: a hand-authored
//      file at the slug's path throws `ConflictError` before any DB
//      touch — Vynel never overwrites a file it did not write.
//   3. `createAgent` (row + outbox in one tx). If it still throws (a
//      create race), the just-written mirror is removed: an orphaned
//      `.claude/agents/*.md` with no row would be a LIVE filesystem
//      agent in plain Claude Code sessions.
//
// Safe while enabled: the SDK loads `.claude/agents/*.md`, but the
// programmatic `query({ agents })` definition (same slug) always takes
// precedence — the mirror is shadowed, never double-registered.

import type { Database } from '@vynel/db'
import { ConflictError, NotFoundError } from '@vynel/errors'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type { AgentRow, AgentScope, StructuralLogger } from '../agents-types.js'
import { renderAgentMirrorMarkdown } from '../internal/render-agent-mirror-markdown.js'
import {
  resolveAgentMirrorPath,
  type AgentMirrorLocator,
} from '../internal/resolve-agent-mirror-path.js'
import {
  removeAgentMirrorOnDisk,
  writeAgentMirrorOnDisk,
} from '../internal/agent-mirror-on-disk.js'
import { createAgent, type CreateAgentInput } from './create-agent.js'

export async function installMarketplaceAgent(
  db: Database,
  input: CreateAgentInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<AgentRow> {
  const scope: AgentScope = input.workspaceId === null ? 'user' : 'workspace'

  const existing = agentsRepository.findAgentBySlug(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    slug: input.slug,
  })
  if (existing) {
    throw new ConflictError(
      `An agent with slug "${input.slug}" already exists at ${scope} scope.`,
    )
  }

  const locator: AgentMirrorLocator = {
    scope,
    workspaceId: input.workspaceId,
    slug: input.slug,
  }
  const mirrorPath = resolveAgentMirrorPath(db, locator)
  if (mirrorPath === null) {
    // An install needs its disk home — the route verified this workspace
    // moments ago, so a miss here means it vanished mid-request.
    throw new NotFoundError('workspace', input.workspaceId ?? '(user scope)')
  }

  // File present ⇔ installed AND enabled (`syncAgentMirrorOnDisk`'s
  // invariant): a disabled row must never leave a live filesystem agent
  // behind — the SDK loads `.claude/agents/*.md`, and only an ENABLED
  // row's programmatic definition shadows it.
  const enabled = input.enabled ?? true
  if (enabled) {
    await writeAgentMirrorOnDisk(mirrorPath, renderAgentMirrorMarkdown(input))
  }
  try {
    return await createAgent(db, input, deps)
  } catch (error) {
    // On a create race this cleanup can also remove the WINNER's
    // just-written mirror (same path, same marker). That errs in the
    // SAFE direction of the invariant — absent-while-enabled merely
    // hides a live row from plain sessions, never the reverse — and
    // the duplicate pre-check above makes the window tiny.
    if (enabled) {
      await removeAgentMirrorOnDisk(db, locator, deps.logger)
    }
    throw error
  }
}
