// The voice relay's functional core — the async fire-and-notify pieces that turn
// a backgrounded /root/turn stream into spoken notifications, plus the spoken-
// summary reducer. The audio I/O + the haiku triage session + the HTTP client
// live in the apps/voice shell (the imperative layer); this package is pure +
// headless-testable. Design: .claude/ceo/agent-base/voice-relay-design.md.
export * from './relay/summarize-turn-for-voice.js'
export * from './relay/spoken-gist.js'
export * from './relay/strip-spoken-markup.js'
export * from './relay/relay-task-notifier.js'
export * from './relay/sentence-buffer.js'
export * from './relay/ack-library.js'
export * from './turn-taking/turn-taking-gate.js'
export * from './turn-taking/barge-in.js'
export * from './turn-taking/wake-word.js'
export * from './turn-taking/audio-segmenter.js'
