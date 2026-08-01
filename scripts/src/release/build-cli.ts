// Phase C of docs/release-plan.md: the @vynel/cli npm artifact.
//
//   tsx scripts/src/release/build-cli.ts
//
// Output (apps/cli/dist-npm/ — the publish dir, generated whole):
//   dist/cli.mjs         apps/cli bundled+minified (sdk, commander, zod inside)
//   dist/mcp-server.mjs  apps/mcp external stdio server, same treatment
//   bin/vynel.mjs        launcher: `vynel mcp` → the stdio server, else the CLI
//   package.json         @vynel/cli — bin only, ZERO dependencies (all bundled)
//   README.md            install + Claude Code integration instructions
//
// Nothing from the workspace ships as source; publishing is `pnpm publish`
// from dist-npm with Chad's npm auth (never automated here). Both programs
// talk HTTP to a running daemon (VYNEL_API_URL, default the installed app's
// port) — the artifact carries no database, no AI runtime.

import { build } from 'esbuild'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const publishDir = join(repoRoot, 'apps', 'cli', 'dist-npm')

function appVersion(): string {
  // One version stream for the product: the desktop app's version stamps the
  // CLI artifact too.
  const config = JSON.parse(
    readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
  ) as { version: string }
  return config.version
}

async function bundleEntries(version: string): Promise<void> {
  const shared = {
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    minify: true,
    sourcemap: false,
  } as const
  await build({
    ...shared,
    entryPoints: [join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')],
    outfile: join(publishDir, 'dist', 'cli.mjs'),
    define: { __VYNEL_CLI_VERSION__: JSON.stringify(version) },
  })
  await build({
    ...shared,
    entryPoints: [join(repoRoot, 'apps', 'mcp', 'src', 'external-server.ts')],
    outfile: join(publishDir, 'dist', 'mcp-server.mjs'),
  })
}

function writeLauncher(): void {
  mkdirSync(join(publishDir, 'bin'), { recursive: true })
  writeFileSync(
    join(publishDir, 'bin', 'vynel.mjs'),
    [
      '#!/usr/bin/env node',
      "// `vynel mcp` runs the MCP stdio server (Claude Code integration);",
      '// everything else is the CLI. Both dispatch to the running Vynel daemon.',
      "if (process.argv[2] === 'mcp') {",
      "  await import('../dist/mcp-server.mjs')",
      '} else {',
      "  await import('../dist/cli.mjs')",
      '}',
      '',
    ].join('\n'),
  )
}

function writePackageManifest(version: string): void {
  writeFileSync(
    join(publishDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@vynel/cli',
        version,
        description:
          'Command-line client and MCP server for Vynel — drive your local Vynel daemon from a shell, a script, or Claude Code.',
        license: 'UNLICENSED',
        type: 'module',
        bin: { vynel: './bin/vynel.mjs' },
        engines: { node: '>=20' },
        repository: 'https://github.com/kafijunior/vynel-releases',
        // Scoped packages default to RESTRICTED on first publish — without
        // this, `npm publish` fails and `npx @vynel/cli` could never work.
        publishConfig: { access: 'public' },
      },
      null,
      2,
    )}\n`,
  )
}

function writeReadme(version: string): void {
  writeFileSync(
    join(publishDir, 'README.md'),
    [
      `# @vynel/cli ${version}`,
      '',
      'Command-line client and MCP server for [Vynel](https://github.com/kafijunior/vynel-releases).',
      'Both need a running Vynel app (the daemon answers on `http://localhost:18892`;',
      'override with `VYNEL_API_URL`).',
      '',
      '## CLI',
      '',
      '```bash',
      'npx -y @vynel/cli --help',
      'npx -y @vynel/cli knowledge search --workspace <id> "release notes"',
      '```',
      '',
      '## Claude Code integration (MCP)',
      '',
      '```bash',
      'claude mcp add vynel -- npx -y @vynel/cli mcp',
      '```',
      '',
      "Claude Code then sees Vynel's tools (knowledge, memory, skills, schedules,",
      'channels, …) and drives your local Vynel over HTTP.',
      '',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  const version = appVersion()
  console.log(`build-cli: @vynel/cli ${version} → ${publishDir}`)
  // Clear CONTENTS, keep the dir: deleting the root EBUSYs when any shell
  // still sits in it (e.g. the terminal `npm publish` just ran from).
  mkdirSync(publishDir, { recursive: true })
  for (const entry of readdirSync(publishDir)) {
    rmSync(join(publishDir, entry), { recursive: true, force: true })
  }

  await bundleEntries(version)
  writeLauncher()
  writePackageManifest(version)
  writeReadme(version)
  console.log('build-cli: done — next, run verify-cli.ts (then publish from dist-npm with npm auth).')
}

main().catch((err) => {
  console.error('build-cli failed:', err)
  process.exitCode = 1
})
