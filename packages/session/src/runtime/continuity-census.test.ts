// The CONTINUITY CENSUS — a source-tree guard in the spirit of the MCP parity
// checks: every production runner that drives `consumeSessionEventStream`
// (the persistence engine of a turn) must also ride `withBoundaryContinuity`
// (link → measure → swap at pressure, announced on the same stream). The arc
// made continuity uniform by construction — the wrapper cannot be forgotten
// on a new runner ONLY if something fails when it is. This is that something:
// a sixth runner that consumes without wrapping fails here before it lands.
//
// Two assertions: (1) the set of files that consume equals the set that wrap
// (file-level co-presence — the runners keep both calls in one function);
// (2) the roster is the known one — add a new runner here deliberately, with
// its wrapper, the way a catalog snapshot is bumped.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const SOURCE_ROOTS = ['packages', 'apps'] as const
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'generated', 'test-support'])

// Definitions and re-exports must not count as call sites: the persistence
// engine's own `export async function* consumeSessionEventStream(` line, and
// the wrapper's. A call is the bare name followed by `(` outside a comment.
const CONSUME_CALL = /(?<!function\*?\s)(?<![\w.])consumeSessionEventStream\(/
const WRAP_CALL = /(?<!function\*?\s)(?<![\w.])withBoundaryContinuity\(/

/** The runners today — 5 ↔ 5 (audit 2026-08-19 §6). */
const KNOWN_RUNNERS = [
  'packages/session/src/delegation/delegate-to-agent-session.ts',
  'packages/session/src/delegation/delegate-to-spawned-session.ts',
  'packages/session/src/delegation/delegate-to-workspace-root.ts',
  'packages/session/src/runtime/run-global-root-turn-core.ts',
  'packages/session/src/runtime/start-chat-turn.ts',
]

function* productionSourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) yield* productionSourceFiles(full)
      continue
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue
    yield full
  }
}

function callsIn(file: string, pattern: RegExp): boolean {
  return readFileSync(file, 'utf8')
    .split('\n')
    .some((line) => {
      const trimmed = line.trimStart()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false
      return pattern.test(line)
    })
}

function census(): { consumers: string[]; wrappers: string[] } {
  const consumers: string[] = []
  const wrappers: string[] = []
  for (const root of SOURCE_ROOTS) {
    for (const file of productionSourceFiles(path.join(repoRoot, root))) {
      const relative = path.relative(repoRoot, file).split(path.sep).join('/')
      if (callsIn(file, CONSUME_CALL)) consumers.push(relative)
      if (callsIn(file, WRAP_CALL)) wrappers.push(relative)
    }
  }
  return { consumers: consumers.sort(), wrappers: wrappers.sort() }
}

describe('continuity census', () => {
  it('every production consumeSessionEventStream call site also rides withBoundaryContinuity', () => {
    const { consumers, wrappers } = census()
    expect(consumers.length).toBeGreaterThan(0)
    const unwrapped = consumers.filter((file) => !wrappers.includes(file))
    const strayWrappers = wrappers.filter((file) => !consumers.includes(file))
    expect(unwrapped, 'runners that consume a turn stream without the boundary-continuity wrapper').toEqual([])
    expect(strayWrappers, 'boundary-continuity wrappers outside a runner').toEqual([])
  })

  it('the runner roster is the known one (bump this list deliberately when a runner is added, WITH its wrapper)', () => {
    expect(census().consumers).toEqual(KNOWN_RUNNERS)
  })
})
