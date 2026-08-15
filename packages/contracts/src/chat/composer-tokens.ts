// The composer token grammar — the ONE home for what `@mention`, `#workspace`,
// and `/command` look like inside a chat message (chat-mentions, Task 3).
//
// Both ends parse the SAME text with THIS parser: the composer highlights and
// anchors its pickers on the offsets; the server re-parses `userMessageText` as
// the source of truth (a client-resolved id is never trusted for routing — the
// dispatch-message "ambient context, never model input" posture). The format
// helpers below are the inverse: what a picker inserts is exactly what this
// parser reads back, so the two directions cannot drift.
//
// Token forms (settled 2026-08-02):
//   @code-reviewer   agent slug (kebab-lowercase) — resolution tries agents first
//   @Sarah           workspace persona (Capitalized manager first name)
//   #vynel           workspace ref, simple form (letters/digits/._-)
//   #"Q3 plans"      workspace ref, quoted form (any name; no double quotes)
//   /deploy /git:push slash command — message START only (Claude Code semantics)
//
// `@` and `#` fire at a word boundary (start of text or after whitespace), so
// `chad@acme.com` and `issue#42` stay plain text. An unresolvable token is just
// text too — resolution drops it silently (the existing mention posture).

export interface ComposerMentionToken {
  /** The mention as typed, without the `@`. */
  name: string
  /** Offset of the `@` in the text. */
  start: number
  /** Exclusive end offset (after the last name character). */
  end: number
}

export interface ComposerWorkspaceToken {
  /** The workspace name as typed (quotes stripped for the quoted form). */
  name: string
  quoted: boolean
  /** Offset of the `#` in the text. */
  start: number
  /** Exclusive end offset (after the name / the closing quote). */
  end: number
}

export interface ComposerSlashToken {
  /** The command name without the slash — may be namespaced (`git:commit`). */
  command: string
  /** Offset of the `/` in the text. */
  start: number
  /** Exclusive end offset (after the last command character). */
  end: number
}

export interface ComposerTokens {
  mentions: ComposerMentionToken[]
  workspaceRefs: ComposerWorkspaceToken[]
  /** At most one — a slash command exists only at the message start. */
  slashCommand: ComposerSlashToken | null
}

// `@name` — first char alphanumeric, interior single hyphens (covers kebab
// agent slugs AND Capitalized persona names in ONE list; resolution
// disambiguates). No trailing hyphen: `@fix-` reads as mention `fix` + text.
const MENTION_PATTERN = /(?<=^|\s)@([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/g

// `#name` (simple charset) or `#"name with spaces"` (any chars but `"` and
// newline). The quoted alternative comes FIRST so `#"a b"` never half-matches
// as a simple token.
const WORKSPACE_PATTERN = /(?<=^|\s)#(?:"([^"\n]+)"|([A-Za-z0-9][A-Za-z0-9._-]*))/g

// `/command` at the very start (leading whitespace tolerated), optionally
// namespaced with `:` segments. Anything after the first whitespace is the
// command's arguments — not part of the token.
const SLASH_PATTERN = /^\s*(\/[A-Za-z0-9][A-Za-z0-9_-]*(?::[A-Za-z0-9][A-Za-z0-9_-]*)*)/

/** The simple (unquoted) `#ref` form — the picker quotes anything outside it. */
const SIMPLE_WORKSPACE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Pure parse of one composer text — every token with its offsets, in order. */
export function parseComposerTokens(text: string): ComposerTokens {
  const mentions: ComposerMentionToken[] = []
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const name = match[1]
    if (name === undefined) continue
    mentions.push({ name, start: match.index, end: match.index + 1 + name.length })
  }

  const workspaceRefs: ComposerWorkspaceToken[] = []
  for (const match of text.matchAll(WORKSPACE_PATTERN)) {
    const quotedName = match[1]
    const simpleName = match[2]
    const name = quotedName ?? simpleName
    if (name === undefined) continue
    workspaceRefs.push({
      name,
      quoted: quotedName !== undefined,
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  const slashMatch = SLASH_PATTERN.exec(text)
  const slashToken = slashMatch?.[1]
  const slashCommand: ComposerSlashToken | null =
    slashMatch !== null && slashToken !== undefined
      ? {
          command: slashToken.slice(1),
          start: slashMatch[0].length - slashToken.length,
          end: slashMatch[0].length,
        }
      : null

  return { mentions, workspaceRefs, slashCommand }
}

/** Rewrite every `@mention` in PLAIN TEXT, through the SAME grammar the
 *  composer inserts with and the server resolves against — so what a thread
 *  paints as a mention is exactly what was parsed as one, and `chad@acme.com`
 *  stays an address in both. The caller supplies the replacement; text with no
 *  mention is returned untouched.
 *
 *  Plain text only: a caller holding markup must hand this the text runs, not
 *  the markup, or it will rewrite inside tags and code. */
export function replaceMentions(
  text: string,
  replace: (name: string) => string,
): string {
  return text.replace(MENTION_PATTERN, (whole, name: string) =>
    typeof name === 'string' ? replace(name) : whole,
  )
}

/** The token a picker inserts for an agent (`@code-reviewer`). */
export function formatAgentMentionToken(slug: string): string {
  return `@${slug}`
}

/** The token a picker inserts for a workspace persona (`@Sarah`). */
export function formatPersonaMentionToken(managerName: string): string {
  return `@${managerName}`
}

/** The token a picker inserts for a workspace — auto-quoted when the name
 *  falls outside the simple charset. A name containing double quotes CANNOT
 *  round-trip: the quoted grammar can't carry `"`, so the stripped token
 *  parses to a DIFFERENT name and server resolution (an exact full-name
 *  match) will never find it. The strip only keeps the output well-formed —
 *  roster builders must FILTER such names out instead of offering a dead
 *  token (composer-suggestion-rosters does). */
export function formatWorkspaceRefToken(name: string): string {
  if (SIMPLE_WORKSPACE_NAME_PATTERN.test(name)) return `#${name}`
  return `#"${name.replaceAll('"', '')}"`
}

/** The token a picker inserts for a slash command (`/git:commit`). */
export function formatSlashCommandToken(command: string): string {
  return `/${command}`
}
