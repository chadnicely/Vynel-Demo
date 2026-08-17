// `composeContinuationTurn` — the ONE home for what a continuation turn says.
// After a checkpoint (and, usually, the boundary swap) Vynel starts the next
// turn itself; the model must know it is Vynel speaking, not the user, and the
// user must see an honest row for it. Two texts, one row:
//
//   - the PERSISTED body — the short anchor row every surface shows
//     ("Continuing after patching context — next: …"), stamped with the
//     relayed-anchor sourceKind ('global-root', no label): the thread renders
//     it as Claude continuing, never as something the user typed, and no
//     origin chip is invented for it;
//   - the PROVIDER text — the fuller instruction the model reads (provider
//     input only, the voice-marker precedent), naming the next step and the
//     rules: continue, do not restart finished work, checkpoint again if the
//     context fills.

import type { TurnMessageAttribution } from '@vynel/chat'
import type { PendingCheckpoint } from '../continuity/index.js'

export type ContinuationTurn = {
  checkpoint: PendingCheckpoint
  /** The visible row — short and honest. */
  persistedBody: string
  /** What the model reads (provider input only). */
  providerText: string
  /** The user row's attribution — the relayed-anchor shape (not the user). */
  attribution: Pick<TurnMessageAttribution, 'userSourceKind'>
}

export function composeContinuationTurn(checkpoint: PendingCheckpoint): ContinuationTurn {
  return {
    checkpoint,
    persistedBody: `Continuing after patching context — next: ${checkpoint.nextStep}`,
    providerText:
      'This message is from Vynel, not the user. You checkpointed because your context was nearly ' +
      'full; the conversation was continued on a fresh context (the hand-off you were seeded with is ' +
      'your own). Continue the work from that checkpoint now.\n\n' +
      `NEXT STEP: ${checkpoint.nextStep}\n\n` +
      'Do not restart finished work — the hand-off says what is done. When this step is complete, keep ' +
      'going with the task as the user asked; if your context fills again, finish the slice you are ' +
      'on and checkpoint again. Speak to the user as you normally would — they see this row as ' +
      '"continuing after patching context".',
    attribution: { userSourceKind: 'global-root' },
  }
}
