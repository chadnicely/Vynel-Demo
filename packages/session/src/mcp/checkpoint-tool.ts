// The `checkpoint` SDK MCP tool — the model's "I am stopping here to swap;
// continue with this" (docs/module-notes/session-continuity.md §4.6). Slim by
// design: ONE line naming the next step, no hand-off prose (the swap carries
// context the way it already does — the distill + the contextBuilder). The
// tool records the pending checkpoint on the turn's OWN identity (the compose
// context's stable primary id — never model input, so it cannot checkpoint
// another session; the register is that identity's own row, so the mark
// outlives the process), and answers with what to do next: end this turn with
// a one-line note to the user. The boundary swap then runs, and the runner
// continues the work on the fresh context automatically.
//
// A plain conversation (no continuing identity) cannot checkpoint — it neither
// swaps nor continues; the tool says so plainly and the model simply finishes.

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Database } from '@vynel/db'
import { recordCheckpointSupersedingSurvivor } from '../continuity/checkpoint-survivors.js'
import type { McpToolFn } from '@vynel/mcp-contract'

// HONEST ON EVERY SURFACE (audit r2 R2-N): the description used to promise
// every turn "Vynel continues you automatically" — true on a conversation that
// auto-continues, false on the spoken thread and on delivery / note turns,
// where the user heard the promise and then silence. Both halves are stated.
const TOOL_DESCRIPTION =
  'Checkpoint your work because your context is nearly full (a CONTEXT CHECK told you so): pass ' +
  'the SINGLE next step to take, in one line — not a summary of what was done (Vynel distills ' +
  'that itself). Then END this turn with one line telling the user you will continue after ' +
  'patching context. Vynel swaps you onto a fresh context; on a conversation that auto-continues ' +
  'it then resumes you with that step automatically, and everywhere else (the spoken thread, a ' +
  'delivery or note turn) the checkpoint is surfaced on the conversation and picked up on its next ' +
  'turn. Call it only when a context check asked you to, or whoami shows you are past the swap ' +
  'threshold with more work to do.'

const NEXT_STEP_MAX_CHARS = 600

export interface CheckpointToolScope {
  /** The turn's own continuing identity — absent for a plain conversation. */
  primarySessionId?: string
  /** When THIS turn began. The supersession line (`checkpoint-survivors.ts`):
   *  a checkpoint older than this was left by an earlier turn, which this turn
   *  never saw, so replacing it is a loss and is said out loud. Required — the
   *  tool cannot judge supersession without knowing which turn it is. */
  turnStartedAt: Date
}

export function buildCheckpointResponse(
  db: Database,
  scope: CheckpointToolScope,
  args: { nextStep: string },
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const nextStep = args.nextStep.trim().slice(0, NEXT_STEP_MAX_CHARS)
  if (scope.primarySessionId === undefined) {
    return {
      content: [
        {
          type: 'text',
          text:
            'This conversation has no continuing identity (it was opened by id or started fresh), so it ' +
            'neither swaps nor continues automatically — there is nothing to checkpoint. Finish what you ' +
            'can in this turn and tell the user where things stand.',
        },
      ],
      isError: true,
    }
  }
  if (nextStep.length === 0) {
    return {
      content: [{ type: 'text', text: 'checkpoint needs a nextStep — one line naming what to do next.' }],
      isError: true,
    }
  }
  recordCheckpointSupersedingSurvivor(db, scope.primarySessionId, nextStep, {
    survivorBefore: scope.turnStartedAt,
  })
  return {
    content: [
      {
        type: 'text',
        text:
          `Checkpoint noted: "${nextStep}". Now END this turn with one line telling the user you will ` +
          'continue after patching context — do not start the next step here. Vynel swaps you onto a ' +
          'fresh context: on a conversation that auto-continues it resumes you with that step by itself, ' +
          'and elsewhere the step is surfaced on the conversation for its next turn.',
      },
    ],
  }
}

/** Construct the `checkpoint` SDK MCP tool. */
export function makeCheckpointTool(db: Database, scope: CheckpointToolScope): unknown {
  return (tool as unknown as McpToolFn)(
    'checkpoint',
    TOOL_DESCRIPTION,
    { nextStep: z.string().min(1).max(NEXT_STEP_MAX_CHARS).describe('The single next step to take on the fresh context — one line.') },
    async (args) => {
      try {
        return buildCheckpointResponse(db, scope, { nextStep: String(args['nextStep'] ?? '') })
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: false, idempotentHint: true } },
  )
}
