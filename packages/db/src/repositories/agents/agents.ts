// Functional repository for the `agents` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3` + `.claude/rules/
// coding-standard.md`). Spec: `docs/agent-base/agents.md`.
//
// Phase 1 SYNC return values per
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// `find*` returns null on missing; typed throws happen at the core
// boundary per `.claude/rules/error-handling.md` "Layering" — repos
// throw only plain `Error` for internal-invariant violations (e.g.
// `.returning()` empty).
//
// Normal reads filter `deletedAt IS NULL` — soft-deleted agents are
// invisible to every read here (data-standard "Soft delete"; a missing
// filter is review-blocking). The retention purge primitive
// (`hardDeleteAgentsDeletedBefore`) is the only function that sees
// soft-deleted rows.
//
// Tenant isolation: every mutating function encodes the `userId` filter
// in the WHERE clause (data-standard "Tenant isolation by repo-layer
// convention"). Cross-tenant rows match nothing → null, which the core
// layer translates to `NotFoundError` (no enumeration leak).

import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { Database } from '../../client.js'
import { agents, type AgentRow, type NewAgentRow } from '../../schema/agents/agents.js'

export type {
  AgentRow,
  NewAgentRow,
  AgentScope,
  AgentSource,
  AgentTrustTier,
  AgentEffort,
  AgentPermissionMode,
} from '../../schema/agents/agents.js'

export function findAgentById(db: Database, agentId: string): AgentRow | null {
  const [row] = db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), isNull(agents.deletedAt)))
    .limit(1)
    .all()
  return row ?? null
}

export type FindAgentBySlugInput = {
  userId: string
  // null = look up the user-scope agent; non-null = look up the
  // workspace-scope agent for that workspace.
  workspaceId: string | null
  slug: string
}

export function findAgentBySlug(db: Database, input: FindAgentBySlugInput): AgentRow | null {
  const workspaceClause =
    input.workspaceId === null
      ? isNull(agents.workspaceId)
      : eq(agents.workspaceId, input.workspaceId)

  const [row] = db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.userId, input.userId),
        workspaceClause,
        eq(agents.slug, input.slug),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export type ListAgentsForUserAndWorkspaceInput = {
  userId: string
  workspaceId: string
}

// Union of user-scope rows (workspaceId IS NULL — available in every
// workspace) + workspace-scope rows for THIS workspace. Live rows only,
// newest first. Phase 1 list size is bounded by the curated catalog +
// the user's own agents — small in practice.
export function listAgentsForUserAndWorkspace(
  db: Database,
  input: ListAgentsForUserAndWorkspaceInput,
): AgentRow[] {
  return db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.userId, input.userId),
        isNull(agents.deletedAt),
        or(isNull(agents.workspaceId), eq(agents.workspaceId, input.workspaceId)),
      ),
    )
    .orderBy(desc(agents.createdAt))
    .all()
}

// As above, but only enabled agents — the input to
// `resolveEnabledAgentsForSession`.
export function listEnabledAgentsForUserAndWorkspace(
  db: Database,
  input: ListAgentsForUserAndWorkspaceInput,
): AgentRow[] {
  return db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.userId, input.userId),
        eq(agents.enabled, true),
        isNull(agents.deletedAt),
        or(isNull(agents.workspaceId), eq(agents.workspaceId, input.workspaceId)),
      ),
    )
    .orderBy(desc(agents.createdAt))
    .all()
}

export function insertAgent(db: Database, newRow: NewAgentRow): AgentRow {
  const [inserted] = db.insert(agents).values(newRow).returning().all()
  if (!inserted) {
    throw new Error('insertAgent: no row returned')
  }
  return inserted
}

// Patchable columns only — identity (`id`, `userId`, `workspaceId`,
// `scope`, `source`), provenance, and `createdAt` are never updated
// through this function.
export type AgentPatch = Partial<
  Omit<
    AgentRow,
    'id' | 'userId' | 'workspaceId' | 'scope' | 'source' | 'createdAt' | 'updatedAt'
  >
>

export function updateAgent(
  db: Database,
  agentId: string,
  userId: string,
  patch: AgentPatch,
): AgentRow | null {
  const [updated] = db
    .update(agents)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId), isNull(agents.deletedAt)))
    .returning()
    .all()
  return updated ?? null
}

// Soft-delete: sets `deletedAt`. Tenant-filtered; only affects a live
// row. Returns the updated row, or null when no live row matched
// (already deleted / not owned / nonexistent).
export function softDeleteAgent(
  db: Database,
  agentId: string,
  userId: string,
): AgentRow | null {
  const now = new Date()
  const [updated] = db
    .update(agents)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId), isNull(agents.deletedAt)))
    .returning()
    .all()
  return updated ?? null
}

// Retention purge primitive — hard-deletes agents soft-deleted before
// the cutoff (cascades to `agent_skills`). Returns the count removed.
// The scheduled caller (purge worker job) is a follow-up unit; this is
// the data-layer mechanism it will use.
export function hardDeleteAgentsDeletedBefore(db: Database, cutoff: Date): number {
  // `deleted_at < cutoff` is NULL for live rows (deletedAt IS NULL), so
  // they are excluded — only aged soft-deletes match.
  const deleted = db.delete(agents).where(lt(agents.deletedAt, cutoff)).returning().all()
  return deleted.length
}
