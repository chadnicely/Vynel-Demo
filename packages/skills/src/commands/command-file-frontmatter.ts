// The ONE home for a command file's shape: an optional `---` YAML block, then
// the prompt body. Claude Code reads `description` and `argument-hint` from
// the block (plus keys Vynel does not model — `allowed-tools`, `model`…), so
// the parser keeps every OTHER line verbatim and the renderer writes them
// back: a save through Vynel never drops a key a hand-authored file carried.
// A full YAML parser would be a dependency for two scalars, so this reads
// simple `key: value` pairs and leaves the rest alone.

export type CommandFileParts = {
  description: string | null
  argumentHint: string | null
  /** Frontmatter lines Vynel does not model, verbatim, in file order. */
  extraFrontmatterLines: string[]
  /** Everything after the frontmatter block (or the whole file without one). */
  body: string
}

export function parseCommandFile(content: string): CommandFileParts {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const lines = withoutBom.split('\n').map((line) => line.replace(/\r$/, ''))

  let description: string | null = null
  let argumentHint: string | null = null
  const extraFrontmatterLines: string[] = []
  let bodyStartIndex = 0
  if (lines[0] === '---') {
    const closingIndex = lines.indexOf('---', 1)
    if (closingIndex !== -1) {
      for (const line of lines.slice(1, closingIndex)) {
        const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line)
        if (match?.[1] === 'description') description = stripQuotes(match[2]!)
        else if (match?.[1] === 'argument-hint') argumentHint = stripQuotes(match[2]!)
        else extraFrontmatterLines.push(line)
      }
      bodyStartIndex = closingIndex + 1
    }
  }

  return {
    description: description !== null && description.length > 0 ? description : null,
    argumentHint: argumentHint !== null && argumentHint.length > 0 ? argumentHint : null,
    extraFrontmatterLines,
    body: lines.slice(bodyStartIndex).join('\n'),
  }
}

/** The inverse of `parseCommandFile`. No frontmatter at all when there is
 *  nothing to put in it — a bare prompt stays a bare prompt. Values are
 *  JSON-quoted so a colon or a `#` in a description survives YAML. */
export function renderCommandFile(parts: CommandFileParts): string {
  const frontmatterLines = [
    ...(parts.description !== null ? [`description: ${JSON.stringify(parts.description)}`] : []),
    ...(parts.argumentHint !== null
      ? [`argument-hint: ${JSON.stringify(parts.argumentHint)}`]
      : []),
    ...parts.extraFrontmatterLines,
  ]
  // Leading blank lines are the gap after a frontmatter block, never content
  // — dropped so the renderer's own blank line is the only one.
  const body = `${parts.body.replace(/^\s*\n/, '').replace(/\s+$/, '')}\n`
  if (frontmatterLines.length === 0) return body
  return `---\n${frontmatterLines.join('\n')}\n---\n\n${body}`
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  const isQuoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  return isQuoted ? trimmed.slice(1, -1) : trimmed
}
