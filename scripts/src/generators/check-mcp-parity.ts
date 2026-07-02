// CI parity guard for the MCP tool registry. Re-runs the
// generator in-memory + diffs against the checked-in
// `apps/mcp/src/generated/api-tools.ts`. Non-zero exit on drift —
// caller must commit the regenerated file alongside any route
// change that touched an `x-mcp` annotation.
//
// Wired into `pnpm test:parity` alongside `check-schema-parity.ts`.
//
// Per `docs/blueprints/mcp/coding.md §9` "Lockstep CI guard" +
// `sdk-mcp.md` "Discipline".

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const checkedInPath = path.join(repoRoot, 'apps', 'mcp', 'src', 'generated', 'api-tools.ts')

// Read the committed file first so a missing file fails loud with a
// clear "run pnpm api:generate" message rather than a confusing diff.
let committedContent: string
try {
  committedContent = readFileSync(checkedInPath, 'utf8')
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(
    `[mcp:parity] missing ${path.relative(repoRoot, checkedInPath)}; ` +
      `run \`pnpm api:generate\` to emit it. (${(err as Error).message})`,
  )
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}

// Snapshot the file, re-run the generator (which writes to the same
// path), capture the new content, then restore the snapshot. Avoids
// leaving the working tree in a regenerated state on a clean run.
const result = spawnSync(
  'tsx',
  [path.join(repoRoot, 'scripts', 'src', 'generators', 'generate-mcp-tools.ts')],
  { stdio: 'inherit', shell: true },
)
if (result.status !== 0) {
  // Restore + propagate the failure.
  writeFileSync(checkedInPath, committedContent)
  // eslint-disable-next-line n/no-process-exit
  process.exit(result.status ?? 1)
}

const regenerated = readFileSync(checkedInPath, 'utf8')

// Restore the committed file. If they match, the working tree is
// already correct. If they don't match, we WANT the user to see the
// diff — but our job is the parity check, not the fix; restoring
// keeps the working tree in its pre-check state so `git diff` shows
// the user nothing surprising from us.
writeFileSync(checkedInPath, committedContent)

if (regenerated !== committedContent) {
  // eslint-disable-next-line no-console
  console.error(
    `[mcp:parity] drift detected — \`apps/mcp/src/generated/api-tools.ts\` ` +
      `does NOT match what the generator would emit. ` +
      `Run \`pnpm api:generate\` and commit the result.`,
  )
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log('[mcp:parity] ok — generated file matches the committed snapshot.')
