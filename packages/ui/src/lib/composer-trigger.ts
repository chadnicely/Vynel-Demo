// Pure caret-side trigger detection for the composer's mention pickers
// (chat-mentions). Given the draft text and the caret position, decides
// whether the caret currently sits inside an OPEN trigger token — `@` / `#`
// (word-boundary anywhere) or `/` (message start only) — and what has been
// typed after it (the picker's filter query). The menu opens on the BARE
// trigger character (empty query — Chad's rule: a mention picker, not a
// type-ahead-only autocomplete).
//
// The token charsets mirror `@vynel/contracts/chat/composer-tokens` (the wire
// grammar's one home); this file only decides the LIVE editing state, which
// the grammar itself cannot express (an unclosed `#"…` is plain text to the
// parser but an open picker context here).

export type ComposerTrigger = '@' | '#' | '/'

export interface ComposerTriggerContext {
  trigger: ComposerTrigger
  /** What was typed after the trigger up to the caret (quotes stripped for
   *  the open `#"` form) — the picker's filter. Empty on the bare trigger. */
  query: string
  /** Offset of the trigger character in the text. */
  start: number
}

// An OPEN quoted workspace ref: `#"` then anything quote/newline-free to the
// caret. Checked first so `#"my wo` keeps the picker open across the space.
const OPEN_QUOTED_WORKSPACE_PATTERN = /(?<=^|\s)#"([^"\n]*)$/
const SIMPLE_WORKSPACE_PATTERN = /(?<=^|\s)#([A-Za-z0-9][A-Za-z0-9._-]*|)$/
const MENTION_PATTERN = /(?<=^|\s)@([A-Za-z0-9-]*)$/
// The whole text before the caret is just (whitespace +) the command —
// slash triggers at the message start only (Claude Code semantics).
const SLASH_PATTERN = /^\s*\/([A-Za-z0-9_:-]*)$/

/** The trigger context the caret sits in, or null when there is none. */
export function detectComposerTrigger(
  text: string,
  caretIndex: number,
): ComposerTriggerContext | null {
  const beforeCaret = text.slice(0, caretIndex)

  const slash = SLASH_PATTERN.exec(beforeCaret)
  if (slash !== null) {
    return { trigger: '/', query: slash[1] ?? '', start: beforeCaret.indexOf('/') }
  }

  const quoted = OPEN_QUOTED_WORKSPACE_PATTERN.exec(beforeCaret)
  if (quoted !== null) {
    return { trigger: '#', query: quoted[1] ?? '', start: quoted.index }
  }

  const simple = SIMPLE_WORKSPACE_PATTERN.exec(beforeCaret)
  if (simple !== null) {
    return { trigger: '#', query: simple[1] ?? '', start: simple.index }
  }

  const mention = MENTION_PATTERN.exec(beforeCaret)
  if (mention !== null) {
    return { trigger: '@', query: mention[1] ?? '', start: mention.index }
  }

  return null
}

/** Replace the open trigger token with the picked insert text (+ a trailing
 *  space) and return the new text + caret position. */
export function applyComposerSuggestion(
  text: string,
  context: ComposerTriggerContext,
  caretIndex: number,
  insertText: string,
): { text: string; caretIndex: number } {
  const inserted = `${insertText} `
  return {
    text: text.slice(0, context.start) + inserted + text.slice(caretIndex),
    caretIndex: context.start + inserted.length,
  }
}
