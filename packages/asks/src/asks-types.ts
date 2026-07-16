// Domain-only types for the `asks` leaf.

import type { AskAnswers } from '@vynel/contracts/asks/ask-questions'

// The subset of pino the core logs against (the tasks/channels precedent).
export interface StructuralLogger {
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

// What the blocked `ask_user` tool ultimately resolves with. `dismissed` is
// the user's explicit "proceed without me"; `expired` means the awaiting
// process/turn is gone (boot recovery or scope cancel); `cancelled` means the
// turn ended (interrupt/disconnect) while the ask was still open.
export type AskOutcome =
  | { answered: true; answers: AskAnswers }
  | { answered: false; reason: 'dismissed' | 'expired' | 'cancelled' }
