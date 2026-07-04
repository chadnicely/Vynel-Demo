// The voice relay's functional core — the async fire-and-notify pieces that turn
// a backgrounded /root/turn stream into spoken notifications, plus the spoken-
// summary reducer. The audio I/O + the haiku triage session + the HTTP client
// live in the apps/voice shell (the imperative layer); this package is pure +
// headless-testable. Design: .claude/ceo/agent-base/voice-relay-design.md.
export * from './summarize-turn-for-voice.js'
export * from './relay-task-notifier.js'
export * from './sentence-buffer.js'
export * from './turn-taking-gate.js'
export * from './barge-in.js'
export * from './ack-library.js'
export * from './wake-word.js'
export * from './audio-segmenter.js'
