// `PendingAskRegistry` — the in-memory map of `ask_user` tool calls awaiting
// the user's answer. Its `resolve` callback is the lever that lets the answer/
// dismiss routes resume the tool's awaiting promise from outside the handler —
// the providers `PendingApprovalRegistry` precedent.
//
// In-memory only — state does NOT survive a restart; boot recovery
// (`expireAskRequests`) expires the orphaned rows. A genuinely stateful
// service, hence a class (the registry exception to functional ops).

import type { AskOutcome } from '../asks-types.js'

export type PendingAskRecord = {
  askId: string
  userId: string
  workspaceId: string | null // null = a global-root turn's ask
  // The OWNING TURN's key (minted per stream request, carried by that turn's
  // descriptor instance). Turn-end cleanup cancels by THIS — never by
  // (userId, workspaceId) — so two concurrent turns in the same workspace can
  // never cancel each other's parked asks.
  turnKey: string
  resolve: (outcome: AskOutcome) => void
}

export class PendingAskRegistry {
  private readonly pendingByAskId = new Map<string, PendingAskRecord>()

  register(record: PendingAskRecord): void {
    this.pendingByAskId.set(record.askId, record)
  }

  has(askId: string): boolean {
    return this.pendingByAskId.has(askId)
  }

  resolve(askId: string, outcome: AskOutcome): boolean {
    const record = this.pendingByAskId.get(askId)
    if (!record) return false
    record.resolve(outcome)
    this.pendingByAskId.delete(askId)
    return true
  }

  /** Cancels every pending ask THIS turn parked — called from the turn
   *  stream's `finally` (interrupt/disconnect while an ask was open). Resolves
   *  each waiter `cancelled` and returns the ask ids so the caller can expire
   *  the rows. */
  cancelForTurn(turnKey: string): string[] {
    const cancelled: string[] = []
    for (const [askId, record] of this.pendingByAskId.entries()) {
      if (record.turnKey === turnKey) {
        record.resolve({ answered: false, reason: 'cancelled' })
        this.pendingByAskId.delete(askId)
        cancelled.push(askId)
      }
    }
    return cancelled
  }
}
