// Writing down the act that DIDN'T finish.
//
// The record was append-on-success only, which made it quietly dishonest in the
// one case it exists for. A batch that dies at step 3 logged rows 1 and 2 and
// nothing else, so the log read as "two steps, no problem" — and "how far did it
// get" is precisely the question the table was built to answer.
//
// THE DISTINCTION THAT MATTERS: a REFUSAL is not a failure. The plan gate, an
// unresolvable app, an ambiguous selector — all throw before anything touches
// the desktop, and recording those would fill the user's log with things that
// never happened. What must be recorded is attempted-and-threw, where the act
// may have partially landed and nobody can say whether it did.
//
// `ForbiddenError` is the marker: `makePlanGatedAuthorizer` raises it BEFORE the
// act, and it is the only refusal that reaches these catch blocks from the
// authorization path.

import { ForbiddenError } from '@vynel/errors'
import type { DesktopPlanEnvelope } from './desktop-plan-envelope.js'

/**
 * Record an act that threw — unless it was refused before it ran.
 *
 * Called from a tool's catch block, so it must never throw itself; the envelope's
 * own writer already swallows, and this adds no new failure path.
 */
export function recordFailedAct(
  envelope: DesktopPlanEnvelope,
  entry: { tool: string; appName?: string | null; detail: string },
  error: unknown,
): void {
  // Nothing happened, so nothing is recorded. A log that lists refusals reads
  // like a list of things Claude did, which is exactly what it is not.
  if (error instanceof ForbiddenError) return
  envelope.recordAct({
    tool: entry.tool,
    appName: entry.appName ?? null,
    detail: entry.detail,
    // NOT 'ok' and not silence: the act was attempted and may have partially
    // landed. `failed` is the honest reading of "we tried and it threw".
    outcome: 'failed',
    note: error instanceof Error ? error.message : String(error),
  })
}
