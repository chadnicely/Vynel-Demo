// `resolveWhoamiReport` — the op behind the `whoami` tool: what a session can
// learn about ITSELF from Vynel's own rows (docs/module-notes/session-continuity.md
// §4.4). Identity-driven, like the continuity op: the primary row says who the
// conversation is; the current segment's persisted usage says how full it is;
// the duty-book binding says which book teaches its duty. Everything here is
// a READ of the identity's own state — never another session's.
//
// Why a session needs this: to tag what it saves to memory with its identity
// (the memory-tagging convention), to know how much context it has left before
// the swap (self-orientation — the checkpoint slice builds on it), and to know
// whether a duty book exists for its kind yet.
//
// `plain` = a conversation with no continuing identity (a workspace session
// opened by id or started fresh): it neither swaps nor carries context, but it
// still has a workspace, a duty book slot and memory tags.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { findChatSessionById } from '@vynel/chat/repositories'
import { findWorkspaceById } from '@vynel/workspaces'
import * as primarySessionsRepository from '../repositories/index.js'
import {
  DEFAULT_CONTEXT_PRESSURE_THRESHOLD,
  resolveSegmentContextWindow,
} from '../continuity/index.js'
import { describeContinuingIdentity } from './describe-continuing-identity.js'
import { resolveDutyBook, type DutyBook, type DutyBookKind } from './duty-book.js'

export type WhoamiContextState = {
  /** The current segment's last persisted occupancy (input + cache); null before its first usage report. */
  usedTokens: number | null
  contextWindow: number
  usedFraction: number | null
  /** The fraction at which the conversation continues on a fresh context. */
  swapThreshold: number
  /** Tokens left before the swap threshold — negative means the next boundary swaps. */
  tokensUntilSwapThreshold: number | null
  /** Tokens left before the model's hard limit — the headroom Kafi's checkpoint slice reasons about. */
  tokensUntilWindowLimit: number | null
  model: string | null
}

export type WhoamiReport = {
  kind: DutyBookKind
  /** Prose completing "You are …". */
  identity: string
  primarySessionId: string | null
  workspace: { id: string; name: string | null } | null
  agentSlug: string | null
  /** The identity row's title (spawned session / colleague); null otherwise. */
  name: string | null
  /** The chat segment this turn speaks into. */
  currentSegmentId: string | null
  /** The segment this one continues from — readable with the session tools. */
  previousSegmentId: string | null
  context: WhoamiContextState | null
  dutyBook: DutyBook
  /** The tags to stamp on memories this session saves — its identity, findable later. */
  memoryTags: string[]
}

export type ResolveWhoamiReportDeps = {
  /** The duty-book existence lookup — defaults to the verified shelf; tests
   *  inject so the day the books are published needs no test change. */
  bookExists?: (slug: string) => boolean
}

export type ResolveWhoamiReportInput = {
  userId: string
  /** The stable primary id (the tool context's `sessionId`); absent = a plain conversation. */
  primarySessionId?: string
  workspaceId?: string
  /** The chat segment the turn speaks into (the context's lazy chat id, read at call time). */
  chatSessionId?: string
  /** Override of the swap threshold (the env knob the runners honor). */
  swapThreshold?: number
}

// Memory tags are short labels: the kind, a short handle of the stable primary
// id (a UUID would not fit), and the identity's own name. 32 mirrors the memory
// route's `MemoryTagsSchema` cap (apps/local-api/src/routes/memory/schemas.ts)
// — a tag longer than that would be rejected at save time.
const MEMORY_TAG_MAX_CHARS = 32
const PRIMARY_TAG_HANDLE_LENGTH = 8

export function resolveWhoamiReport(
  db: Database,
  input: ResolveWhoamiReportInput,
  deps: ResolveWhoamiReportDeps = {},
): WhoamiReport {
  const primary =
    input.primarySessionId !== undefined
      ? primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
      : null
  if (input.primarySessionId !== undefined && (primary === null || primary.userId !== input.userId)) {
    throw new NotFoundError('primary session', input.primarySessionId)
  }

  const currentSegmentId = input.chatSessionId ?? primary?.currentSdkSessionId ?? null
  const segment = currentSegmentId !== null ? findChatSessionById(db, currentSegmentId) : null
  const ownedSegment = segment !== null && segment.userId === input.userId ? segment : null

  const workspaceId = primary?.workspaceId ?? input.workspaceId ?? null
  const workspace =
    workspaceId !== null
      ? { id: workspaceId, name: findWorkspaceById(db, workspaceId)?.name ?? null }
      : null

  const described =
    primary !== null ? describeContinuingIdentity(db, primary, currentSegmentId) : null
  const kind: DutyBookKind = described?.kind ?? 'plain'
  const identity =
    described?.line ??
    (workspace !== null
      ? `a conversation in ${workspace.name !== null ? `workspace “${workspace.name}”` : 'this workspace'} with no continuing identity (opened by id or started fresh) — it does not swap or carry context`
      : 'a conversation with no continuing identity — it does not swap or carry context')

  const swapThreshold = input.swapThreshold ?? DEFAULT_CONTEXT_PRESSURE_THRESHOLD
  const context: WhoamiContextState | null =
    ownedSegment !== null
      ? contextStateOf(
          ownedSegment.lastContextTokens,
          ownedSegment.model,
          // The SAME denominator the swap decision uses (chosen-model-first,
          // chain fallback) — "where am I" and "when do I swap" must agree.
          resolveSegmentContextWindow(db, ownedSegment.id).contextWindow,
          swapThreshold,
        )
      : null

  return {
    kind,
    identity,
    primarySessionId: primary?.id ?? null,
    workspace,
    agentSlug: primary?.scopeRef ?? null,
    name: described?.name ?? null,
    currentSegmentId,
    // The ROW chain first: every swap writer stamps `continuedFromSessionId`
    // (boundary bridge AND the SDK's mid-turn swap), while the primary's
    // `supersededFromSdkSessionId` is stamped only by the bridge and goes stale
    // across a later mid-turn swap — the transcript walks the rows for the
    // same reason. The marker is the fallback for a legacy row without a link.
    previousSegmentId: ownedSegment?.continuedFromSessionId ?? primary?.supersededFromSdkSessionId ?? null,
    context,
    dutyBook: resolveDutyBook(kind, deps.bookExists !== undefined ? { bookExists: deps.bookExists } : {}),
    memoryTags: memoryTagsFor(kind, primary?.id ?? null, described?.name ?? null),
  }
}

function contextStateOf(
  usedTokens: number | null,
  model: string | null,
  contextWindow: number,
  swapThreshold: number,
): WhoamiContextState {
  return {
    usedTokens,
    contextWindow,
    usedFraction: usedTokens !== null ? usedTokens / contextWindow : null,
    swapThreshold,
    tokensUntilSwapThreshold:
      usedTokens !== null ? Math.floor(contextWindow * swapThreshold) - usedTokens : null,
    tokensUntilWindowLimit: usedTokens !== null ? contextWindow - usedTokens : null,
    model,
  }
}

function memoryTagsFor(kind: DutyBookKind, primarySessionId: string | null, name: string | null): string[] {
  const tags = [`identity:${kind}`]
  if (primarySessionId !== null) tags.push(`session:${primarySessionId.slice(0, PRIMARY_TAG_HANDLE_LENGTH)}`)
  if (name !== null && name.trim().length > 0) tags.push(name.trim().slice(0, MEMORY_TAG_MAX_CHARS))
  return tags
}
