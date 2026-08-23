// Reading what `gh` said. Its failures are usually one line among progress
// noise — keep the last line that says something, never the whole transcript.

export function lastMeaningfulLine(output: string, fallback: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('!') && !/one-time code/i.test(line))
  return lines.at(-1) ?? fallback
}
