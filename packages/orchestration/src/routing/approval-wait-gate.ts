// `ApprovalWaitGate` — the shared signal between a routed turn's approval handler
// and `routeRequest`'s wait budget (surface-up, decision C). While an approval is
// PARKED on a human decision the budget clock must not run — a task the user
// approves after 15 minutes should still complete; the clock resumes when every
// parked approval is decided. The composing tier (the delegation tick) creates ONE
// gate per job, hands it to both sides, and the two never import each other.
//
// Stateful by design (a per-job signal, not a repository) — the provider-runtime
// "genuinely stateful service" exception.

export class ApprovalWaitGate {
  private parkedCount = 0
  private listener: ((parked: boolean) => void) | undefined

  /** An approval was recorded and left unanswered — pause the wait clock. */
  markParked(): void {
    this.parkedCount += 1
    if (this.parkedCount === 1) this.listener?.(true)
  }

  /** A previously parked approval was decided — resume the clock when none remain. */
  markResolved(): void {
    if (this.parkedCount === 0) return
    this.parkedCount -= 1
    if (this.parkedCount === 0) this.listener?.(false)
  }

  get isParked(): boolean {
    return this.parkedCount > 0
  }

  /** Single subscriber — `routeRequest`'s pausable wait. Fires on every edge
   *  (false→parked, parked→false). */
  onParkedChange(listener: (parked: boolean) => void): void {
    this.listener = listener
  }
}
