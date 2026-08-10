// A SUBAGENT's activity, persisted onto its spawning Agent call's row as it
// streams — the narrative appends per text chunk (SQL-side concat, like the
// message body) and the lean tool list (no outputs) rewrites per tool event
// (tool events are sparse; the authoritative array lives in the per-turn
// cache, so no read-modify-write). This is what makes the nested activity
// pane survive settle/reload — the same persistence doctrine the delegation
// trace's rows follow. The wire events stay unchanged: live viewers ride
// them; the row covers everyone who arrives later.
//
// Per-turn state per coding §1.4 — one recorder per consume call, GC'd with
// the generator.

import * as chatRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { SubagentToolCall } from '../repositories/index.js'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import type { StructuralLogger } from '../chat-types.js'

export type SubagentActivityRecorder = {
  onTextChunk(parentToolUseId: string, textDelta: string): ChatTurnEvent
  onToolStarted(
    parentToolUseId: string,
    call: { toolUseId: string; toolName: string; toolInput: unknown; startedAt: Date },
  ): ChatTurnEvent
  onToolCompleted(
    parentToolUseId: string,
    call: { toolUseId: string; toolOutput: unknown; isError: boolean; completedAt: Date },
  ): ChatTurnEvent
  /** The spawning Agent call itself completed — settle any entry still
   *  'started'. On a clean return they only missed their completion events
   *  ('completed'); on an errored return the run died under them ('failed'). */
  onParentSettled(
    parentToolUseId: string,
    outcome: { isError: boolean; completedAt: Date },
  ): void
}

export function createSubagentActivityRecorder(input: {
  db: Database
  /** The consumer's toolUseId → DB-id cache — resolves the Agent call's row. */
  toolCallByToolUseId: Map<string, string>
  logger?: StructuralLogger | undefined
}): SubagentActivityRecorder {
  const { db, toolCallByToolUseId, logger } = input

  // The persisted tool list per Agent call (keyed by its DB id) + the parent
  // ids already warned about (an unknown parent no-ops but must not spam).
  const toolCallsByAgentDbId = new Map<string, SubagentToolCall[]>()
  const warnedParentToolUseIds = new Set<string>()
  // toolUseId → toolName, so the COMPLETED wire frame can name its tool. Kept
  // independently of the persisted entries because those exist only when the
  // parent Agent row resolved — a live consumer (the desktop overlay settling
  // its steps) must not depend on persistence having succeeded.
  const toolNameByToolUseId = new Map<string, string>()

  function agentDbIdFor(parentToolUseId: string): string | null {
    const dbId = toolCallByToolUseId.get(parentToolUseId)
    if (dbId !== undefined) return dbId
    if (!warnedParentToolUseIds.has(parentToolUseId)) {
      warnedParentToolUseIds.add(parentToolUseId)
      logger?.warn(
        { parentToolUseId },
        'subagent event for unknown Agent call — activity not persisted',
      )
    }
    return null
  }

  function writeToolCalls(agentDbId: string): void {
    chatRepository.updateChatToolCall(db, agentDbId, {
      subagentToolCalls: toolCallsByAgentDbId.get(agentDbId) ?? [],
    })
  }

  return {
    onTextChunk(parentToolUseId, textDelta) {
      const agentDbId = agentDbIdFor(parentToolUseId)
      if (agentDbId !== null) {
        chatRepository.appendToChatToolCallSubagentNarrative(db, agentDbId, textDelta)
      }
      return { kind: 'agent-text-chunk', parentToolUseId, textDelta }
    },

    onToolStarted(parentToolUseId, call) {
      toolNameByToolUseId.set(call.toolUseId, call.toolName)
      const agentDbId = agentDbIdFor(parentToolUseId)
      if (agentDbId !== null) {
        const entries = toolCallsByAgentDbId.get(agentDbId) ?? []
        entries.push({
          toolUseId: call.toolUseId,
          toolName: call.toolName,
          toolInput: call.toolInput,
          status: 'started',
          startedAt: call.startedAt.toISOString(),
          completedAt: null,
        })
        toolCallsByAgentDbId.set(agentDbId, entries)
        writeToolCalls(agentDbId)
      }
      return {
        kind: 'agent-tool-started',
        parentToolUseId,
        toolUseId: call.toolUseId,
        toolName: call.toolName,
        toolInput: call.toolInput,
        startedAt: call.startedAt,
      }
    },

    onToolCompleted(parentToolUseId, call) {
      const agentDbId = agentDbIdFor(parentToolUseId)
      if (agentDbId !== null) {
        const entries = toolCallsByAgentDbId.get(agentDbId) ?? []
        const entry = entries.find((row) => row.toolUseId === call.toolUseId)
        if (entry) {
          entry.status = call.isError ? 'failed' : 'completed'
          entry.completedAt = call.completedAt.toISOString()
          writeToolCalls(agentDbId)
        }
      }
      return {
        kind: 'agent-tool-completed',
        parentToolUseId,
        toolUseId: call.toolUseId,
        toolName: toolNameByToolUseId.get(call.toolUseId) ?? null,
        toolOutput: call.toolOutput,
        isError: call.isError,
        completedAt: call.completedAt,
      }
    },

    onParentSettled(parentToolUseId, outcome) {
      const agentDbId = toolCallByToolUseId.get(parentToolUseId)
      if (agentDbId === undefined) return
      const entries = toolCallsByAgentDbId.get(agentDbId)
      if (!entries?.some((row) => row.status === 'started')) return
      const settledAt = outcome.completedAt.toISOString()
      for (const entry of entries) {
        if (entry.status === 'started') {
          entry.status = outcome.isError ? 'failed' : 'completed'
          entry.completedAt = settledAt
        }
      }
      writeToolCalls(agentDbId)
    },
  }
}
