// Schema-parity guard. Verifies every schema file under
// `packages/db/src/schema/<domain>/` (excluding barrel `index.ts` files)
// is registered in `drizzle.sqlite.config.ts` (and, when Phase 2 lands,
// `drizzle.postgres.config.ts`). A missing entry would cause
// drizzle-kit to silently skip the table when generating migrations —
// review-blocking per `.claude/rules/data-standard.md` "Migrations".
//
// Wired into `pnpm test` via `pnpm test:parity`.
//
// Reads the drizzle config file as TEXT rather than importing it as a
// module — keeps `@vynel/scripts` free of drizzle-kit (only @vynel/db
// owns that dep) and avoids the rootDir constraint when crossing
// package boundaries.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

function listSchemaFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      listSchemaFiles(fullPath, out)
      continue
    }
    if (entry === 'index.ts') continue
    if (!entry.endsWith('.ts')) continue
    if (entry.endsWith('.test.ts')) continue
    out.push(fullPath)
  }
  return out
}

function configuredSchemaPaths(configPath: string, packageDir: string): string[] {
  const text = readFileSync(configPath, 'utf8')
  // Pull every quoted string that looks like a relative path containing
  // `/schema/`. We anchor on `/schema/` so unrelated quotes (the package
  // name, the dialect string, etc.) are ignored.
  const matches = text.match(/['"`]\.\/[^'"`]*\/schema\/[^'"`]+['"`]/g) ?? []
  return matches
    .map((m) => m.slice(1, -1)) // strip quotes
    .map((p) => resolve(packageDir, p))
}

export function checkSchemaParity(): void {
  const schemaRoot = join(repoRoot, 'packages', 'db', 'src', 'schema')
  const configPath = join(repoRoot, 'drizzle.sqlite.config.ts')
  // drizzle paths are relative to `packages/db` (where `--filter @vynel/db
  // exec drizzle-kit` runs). The parity check normalizes against the
  // same base for an apples-to-apples comparison.
  const drizzleCwd = join(repoRoot, 'packages', 'db')

  const onDisk = listSchemaFiles(schemaRoot)
    .map((p) => p.replace(/\\/g, '/'))
    .sort()
  const configured = configuredSchemaPaths(configPath, drizzleCwd)
    .map((p) => p.replace(/\\/g, '/'))
    .sort()

  const missing = onDisk.filter((f) => !configured.includes(f))
  const stale = configured.filter((c) => !onDisk.includes(c))

  if (missing.length > 0 || stale.length > 0) {
    const lines: string[] = ['Schema-parity check FAILED:']
    if (missing.length > 0) {
      lines.push('  Schema files on disk but NOT registered in drizzle.sqlite.config.ts:')
      for (const f of missing) lines.push(`    - ${relative(repoRoot, f).split(sep).join('/')}`)
    }
    if (stale.length > 0) {
      lines.push('  Registered in drizzle.sqlite.config.ts but NOT on disk:')
      for (const c of stale) lines.push(`    - ${relative(repoRoot, c).split(sep).join('/')}`)
    }
    lines.push('  Fix: update drizzle.sqlite.config.ts `schema:` to match the on-disk tree.')
    throw new Error(lines.join('\n'))
  }

  // eslint-disable-next-line no-console
  console.log(`schema-parity OK — ${onDisk.length} schema file(s) registered.`)
}

// This file is the CLI entry; tsx invokes it directly. The classic
// `import.meta.url === pathToFileURL(process.argv[1])` guard misfires on
// Windows (file:///E:/... vs file://E:/... triple-vs-double slash). Since
// there is no other importer of this module, call unconditionally.
try {
  checkSchemaParity()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
