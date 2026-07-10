// Schema-parity guard. Verifies every schema file under any
// `packages/<pkg>/src/schema/` (the kernel's domains + any vertical-slice
// feature that owns its schema, e.g. knowledge; excluding barrel `index.ts`
// files) is registered in EXACTLY ONE drizzle config: the product's
// `drizzle.sqlite.config.ts` or the hub's `drizzle.cloud-postgres.config.ts`
// (the cloud second system, docs/module-notes/cloud-api.md §2). A missing
// entry would cause drizzle-kit to silently skip the table when generating
// migrations; a double entry would generate the table in the wrong dialect —
// both review-blocking per `.claude/rules/data-standard.md` "Migrations".
//
// Wired into `pnpm test` via `pnpm test:parity`.
//
// Reads the drizzle config files as TEXT rather than importing them as
// modules — keeps `@vynel/scripts` free of drizzle-kit (only the db kernels
// own that dep) and avoids the rootDir constraint when crossing package
// boundaries.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve, sep } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

// Each drizzle config + the CWD its schema paths are relative to (the
// `--filter <pkg> exec drizzle-kit` target).
const DRIZZLE_CONFIGS = [
  { file: 'drizzle.sqlite.config.ts', cwd: join('packages', 'db') },
  { file: 'drizzle.cloud-postgres.config.ts', cwd: join('packages', 'cloud-db') },
] as const

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
  // Pull every quoted dot-relative path containing `/schema/`. The leading
  // `.` accepts both a kernel-local `./src/schema/...` entry and a
  // cross-package `../<feature>/src/schema/...` one (a feature that owns its
  // schema). Anchoring on `/schema/` ignores unrelated quotes (package name,
  // dialect string, etc.).
  const matches = text.match(/['"`]\.[^'"`]*\/schema\/[^'"`]+['"`]/g) ?? []
  return matches
    .map((m) => m.slice(1, -1)) // strip quotes
    .map((p) => resolve(packageDir, p))
}

// Every `packages/<pkg>/src/schema` directory on disk. The kernels own core
// domains; a vertical-slice feature (e.g. knowledge, accounts) owns its own
// schema in its package — the guard must see all of them.
function findSchemaRoots(): string[] {
  const packagesDir = join(repoRoot, 'packages')
  const roots: string[] = []
  for (const pkg of readdirSync(packagesDir)) {
    const schemaDir = join(packagesDir, pkg, 'src', 'schema')
    try {
      if (statSync(schemaDir).isDirectory()) roots.push(schemaDir)
    } catch {
      // package has no schema dir — skip
    }
  }
  return roots
}

export function checkSchemaParity(): void {
  const onDisk = findSchemaRoots()
    .flatMap((root) => listSchemaFiles(root))
    .map((p) => p.replace(/\\/g, '/'))
    .sort()

  // Path -> the config file(s) that claim it.
  const claims = new Map<string, string[]>()
  const stalePerConfig: string[] = []
  for (const config of DRIZZLE_CONFIGS) {
    const configured = configuredSchemaPaths(
      join(repoRoot, config.file),
      join(repoRoot, config.cwd),
    ).map((p) => p.replace(/\\/g, '/'))
    for (const path of configured) {
      if (!onDisk.includes(path)) {
        stalePerConfig.push(
          `    - ${config.file}: ${relative(repoRoot, path).split(sep).join('/')}`,
        )
        continue
      }
      claims.set(path, [...(claims.get(path) ?? []), config.file])
    }
  }

  const missing = onDisk.filter((f) => !claims.has(f))
  const doubled = [...claims.entries()].filter(([, configs]) => configs.length > 1)

  if (missing.length > 0 || stalePerConfig.length > 0 || doubled.length > 0) {
    const lines: string[] = ['Schema-parity check FAILED:']
    if (missing.length > 0) {
      lines.push('  Schema files on disk but NOT registered in any drizzle config:')
      for (const f of missing) lines.push(`    - ${relative(repoRoot, f).split(sep).join('/')}`)
    }
    if (stalePerConfig.length > 0) {
      lines.push('  Registered in a drizzle config but NOT on disk:')
      lines.push(...stalePerConfig)
    }
    if (doubled.length > 0) {
      lines.push('  Registered in MORE THAN ONE drizzle config (pick one dialect):')
      for (const [f, configs] of doubled) {
        lines.push(`    - ${relative(repoRoot, f).split(sep).join('/')} (${configs.join(', ')})`)
      }
    }
    lines.push(
      '  Fix: update the drizzle config `schema:` lists to match the on-disk tree, one config per file.',
    )
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
