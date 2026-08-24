// Write a generated artifact ONLY when its content changed. Every generator
// used to rewrite its file on every run (identical bytes, fresh mtime), and
// `node --watch` on the dev API restarts on any mtime bump — so each `pnpm
// test` (whose parity guards re-run the generators) restarted the running
// engine mid-turn, orphaning whatever a room was doing (2026-08-25: a room's
// first turn lost its primary link that way). Identical output is a no-op.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export function writeIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false
  writeFileSync(path, content)
  return true
}
