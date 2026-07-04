// The barge-in decision (voice-relay-design.md §4). The relay holds async
// notifications (a task is underway / done / failed) and speaks them only at a
// polite moment: there IS something to say, the user is NOT mid-utterance, and
// the assistant is NOT already speaking. Pure — the shell calls this each idle
// tick to decide whether to drain the RelayTaskNotifier and speak.

export interface BargeInState {
  hasPendingNotifications: boolean
  isUserSpeaking: boolean
  isAssistantSpeaking: boolean
}

export function shouldBargeInNow(state: BargeInState): boolean {
  return (
    state.hasPendingNotifications && !state.isUserSpeaking && !state.isAssistantSpeaking
  )
}
