// CI parity guard for the generated @vynel/sdk artifacts. Re-runs both
// SDK generators + diffs their three outputs
// (`packages/sdk/openapi.json`, `src/generated/api.d.ts`, and
// `src/generated/namespaced.ts`) against the checked-in copies. Non-zero
// exit on drift — the caller must run `pnpm api:generate` and commit the
// regenerated artifacts alongside any route/schema change.
//
// Why guard the SDK too (the MCP registry already has a golden test +
// its own parity guard): the SDK artifacts have NO typecheck consumer
// yet — `apps/web` + `apps/cli` are deferred — so a stale `api.d.ts`
// self-typechecks and would drift silently. Mirrors `check-mcp-parity.ts`.
//
// Wired into `pnpm test:parity` after schema + mcp parity.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const artifacts = [
  path.join(repoRoot, 'packages', 'sdk', 'openapi.json'),
  path.join(repoRoot, 'packages', 'sdk', 'src', 'generated', 'api.d.ts'),
  path.join(repoRoot, 'packages', 'sdk', 'src', 'generated', 'namespaced.ts'),
]

// Snapshot the committed copies first so a missing artifact fails loud
// with a clear "run pnpm api:generate" message rather than a confusing diff.
const committed = new Map<string, string>()
for (const file of artifacts) {
  try {
    committed.set(file, readFileSync(file, 'utf8'))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[sdk:parity] missing ${path.relative(repoRoot, file)}; ` +
        `run \`pnpm api:generate\` to emit it. (${err instanceof Error ? err.message : String(err)})`,
    )
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  }
}

// Re-run both SDK generators IN ORDER (generate-namespaced-sdk reads the
// openapi.json generate-sdk emits), then diff + restore each committed
// copy so the working tree ends in its pre-check state — the parity
// check's job is detection, not the fix.
const generators = ['generate-sdk.ts', 'generate-namespaced-sdk.ts']
for (const generator of generators) {
  const result = spawnSync(
    'tsx',
    [path.join(repoRoot, 'scripts', 'src', 'generators', generator)],
    { stdio: 'inherit', shell: true },
  )
  if (result.status !== 0) {
    for (const [file, content] of committed) writeFileSync(file, content)
    // eslint-disable-next-line n/no-process-exit
    process.exit(result.status ?? 1)
  }
}

const drifted: string[] = []
for (const [file, content] of committed) {
  const regenerated = readFileSync(file, 'utf8')
  if (regenerated !== content) drifted.push(path.relative(repoRoot, file))
  writeFileSync(file, content)
}

if (drifted.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `[sdk:parity] drift detected — ${drifted.join(', ')} ` +
      `do NOT match what the generator would emit. ` +
      `Run \`pnpm api:generate\` and commit the result.`,
  )
  // eslint-disable-next-line n/no-process-exit
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log('[sdk:parity] ok — generated SDK artifacts match the committed snapshot.')
