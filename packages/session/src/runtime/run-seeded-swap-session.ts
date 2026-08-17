// `runSeededSwapSession` — mints the FRESH SDK session for a primary-as-thread
// swap, seeded with the carry. This is the provider side of the seed-fresh
// mechanism (the spike's chosen mechanism — `.claude/ceo/agent-base/
// swap-mechanics-spike-finding.md`): start a brand-new session whose first
// message embeds the distilled hand-off carry, drain the priming turn to
// completion so that exchange is flushed to the runtime's own session storage,
// and return the new SDK session id.
//
// Why the carry rides in the FIRST USER MESSAGE (not `systemPrompt.append`):
// the next REAL user turn RESUMES this session, and resume replays the
// conversation transcript while the system prompt is recomposed fresh per turn
// (Vynel rules + memory snapshot — `composeSessionCapabilities`). A carry placed
// only in the priming turn's append would NOT survive into the resumed turn; a
// carry in the conversation history does. The live swap smoke asserts exactly
// this (next-turn recall) — build brief Slice 1 §6.
//
// The priming exchange is intentionally NOT persisted to Vynel's `chat_messages`
// — only the SDK's session storage holds it. The recorded segment
// (`recordSwapSegmentSession`) starts empty; the next user turn populates it.
// So the user browses a clean continued conversation, while the runtime still
// carries the context. ("Hide for the UI; keep for the platform" —
// `.claude/docs/agent-base/root-session-architecture.md §7`.)

import type { AiAgentProvider } from '@vynel/providers'
import type { StructuralLogger } from '@vynel/logger'

export type RunSeededSwapSessionInput = {
  /** Workspace folder — the seeded session's cwd. */
  workspacePath: string
  /** What the fresh session is seeded with — a swap's composed hand-off
   *  (`buildContinuityContext`), or a spawned session's purpose at birth. */
  carry: string
  /** Model for the cheap priming turn. Omit for the runtime default. */
  model?: string
  /** Wall-clock bound on the priming drain. Omit for the default. */
  timeoutMs?: number
  logger?: StructuralLogger
}

// The priming turn is a one-word acknowledgement with no tools, so a minute is
// already luxurious — this bound exists for the runtime that never terminates
// the stream (a stalled model call), not for a slow answer. It matters because
// `createSpawnedSession` runs this INSIDE the `create_session` MCP tool: an
// unbounded drain parks the calling agent forever, with no card and no error.
const DEFAULT_PRIMING_TIMEOUT_MS = 120_000

// Frames the carry as established background of an ONGOING conversation — the
// priming agent must absorb it and wait, NOT start new work or act on the NEXT
// items (that's the next real user turn's job). It never uses tools. The carry
// itself is the contextBuilder's structured hand-off (identity, summary, the
// last messages verbatim, refs, how to recover more) — or, for a spawned
// session's birth, its purpose.
function buildPrimingPrompt(carry: string): string {
  return [
    'This conversation is being continued from an earlier session whose context was',
    'condensed to free space. Below is the hand-off: who you are, where things stand,',
    'the last messages as they were said, and how to recover more when you need it.',
    'Treat it as the established background of THIS ongoing conversation — do NOT start',
    'new work, do NOT use any tools, and do NOT act on the NEXT items yet. Simply absorb',
    "it and wait for the user's next message. Reply with exactly: Ready to continue.",
    '',
    '=== CARRIED CONTEXT ===',
    carry,
    '=== END CARRIED CONTEXT ===',
  ].join('\n')
}

export async function runSeededSwapSession(
  provider: AiAgentProvider,
  input: RunSeededSwapSessionInput,
): Promise<string> {
  const sessionEventStream = provider.startChatSession({
    workspacePath: input.workspacePath,
    userMessageText: buildPrimingPrompt(input.carry),
    // Auto-allow (Vynel's default); the prompt forbids tools and registers no
    // MCP servers, so the priming turn is a pure one-word acknowledgement.
    permissionMode: 'bypass-with-behavior-gate',
    allowedToolNames: [],
    deniedToolNames: [],
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  })

  let seededSessionId: string | null = null
  // Drain to completion: the priming exchange (carrying the carry) must be
  // fully flushed to the runtime's session storage before the next turn resumes
  // it — abandoning the stream early can leave the transcript unwritten.
  const drain = async (): Promise<void> => {
    for await (const event of sessionEventStream) {
      if (event.kind === 'session-started') {
        seededSessionId = event.sessionId
      }
    }
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_PRIMING_TIMEOUT_MS
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('priming-timeout')), timeoutMs)
  })
  try {
    await Promise.race([drain(), deadline])
  } catch (err) {
    // A real cancel, not just an abandoned await: interrupting terminates the
    // provider's stream, so the runtime isn't left holding a live turn nobody
    // reads. Best-effort — the thrown error below carries the real failure.
    if (err instanceof Error && err.message === 'priming-timeout') {
      if (seededSessionId !== null) {
        await provider.interruptChatSession(seededSessionId).catch((interruptErr: unknown) => {
          input.logger?.warn(
            { err: interruptErr, sessionId: seededSessionId },
            'runSeededSwapSession: interrupt-on-timeout failed',
          )
        })
      }
      throw new Error(
        `runSeededSwapSession: the priming turn did not finish within ${timeoutMs}ms — the seeded session was interrupted. Retry; if it repeats, the agent runtime is not responding.`,
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  if (seededSessionId === null) {
    throw new Error(
      'runSeededSwapSession: the runtime did not assign a session id for the seeded session',
    )
  }
  return seededSessionId
}
