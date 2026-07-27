// Phase A of docs/release-plan.md: assemble the compiled backend payload.
//
//   tsx scripts/src/release/build-payload.ts [win-x64|linux-x64|linux-arm64] [--skip-web]
//
// Output (apps/desktop/src-tauri/payload/):
//   backend/dist/server.mjs        ALL @vynel code, esbuild-bundled + minified
//   backend/dist/*.ps1             runtime helper scripts resolved beside the bundle
//   backend/node_modules/          third-party runtime deps ONLY (hoisted, prod)
//   backend/assets/                migrations-sqlite/ + instructions content
//   web/                           built local-web dist
//   node(.exe)                     pinned, SHA-verified Node runtime
//
// No .ts and no @vynel source anywhere in the payload — verify-payload.ts
// asserts that. Sourcemaps land OUTSIDE the payload (payload-sourcemaps/) for
// our own crash decoding.

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectBackendThirdPartyDependencies } from './collect-backend-dependencies.js'
import { resolvePayloadTarget, type PayloadTarget } from './payload-targets.js'
import { stageNodeRuntime } from './stage-node-runtime.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const payloadDir = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'payload')
const sourcemapDir = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'payload-sourcemaps')
const nodeCacheDir = join(repoRoot, '.cache', 'node-runtimes')

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}.`)
  }
}

async function bundleBackend(backendDir: string): Promise<void> {
  const outfile = join(backendDir, 'dist', 'server.mjs')
  await build({
    entryPoints: [join(repoRoot, 'apps', 'local-api', 'src', 'server.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    sourcemap: 'external',
    // External CJS deps are require()d through this shim when interop needs it.
    banner: {
      js: "import { createRequire as __vynelCreateRequire } from 'node:module';const require = __vynelCreateRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'externalize-third-party',
        setup(pluginBuild) {
          // Bare specifiers stay external (they resolve from the payload's
          // node_modules); every @vynel import bundles — that's the IP.
          pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.path.startsWith('@vynel/')) return null
            if (/^[A-Za-z]:[\\/]/.test(args.path)) return null
            return { path: args.path, external: true }
          })
        },
      },
    ],
  })
  mkdirSync(sourcemapDir, { recursive: true })
  renameSync(`${outfile}.map`, join(sourcemapDir, 'server.mjs.map'))

  // notification-listener.ps1 is resolved beside its compiled module at
  // runtime — in the bundle that means beside server.mjs.
  cpSync(
    join(repoRoot, 'packages', 'desktop-control', 'src', 'notifications', 'notification-listener.ps1'),
    join(backendDir, 'dist', 'notification-listener.ps1'),
  )
}

function installThirdPartyDependencies(backendDir: string, target: PayloadTarget): void {
  const dependencies = collectBackendThirdPartyDependencies(repoRoot)
  writeFileSync(
    join(backendDir, 'package.json'),
    `${JSON.stringify(
      { name: 'vynel-backend', version: '0.0.0', private: true, type: 'module', dependencies },
      null,
      2,
    )}\n`,
  )
  // Its own workspace root: stops pnpm's upward lookup into the repo, carries
  // the per-target architecture + the build-script allowlist, and hoists to a
  // flat npm-style tree (no .pnpm symlink forest inside an installer).
  writeFileSync(
    join(backendDir, 'pnpm-workspace.yaml'),
    [
      'packages: []',
      'nodeLinker: hoisted',
      'supportedArchitectures:',
      `  os: ["${target.os}"]`,
      `  cpu: ["${target.cpu}"]`,
      'allowBuilds:',
      '  better-sqlite3: true',
      '  cpu-features: true',
      '  onnxruntime-node: true',
      '  protobufjs: true',
      '  sharp: true',
      '  ssh2: true',
      '',
    ].join('\n'),
  )
  run('pnpm', ['install', '--prod'], backendDir)
}

function copyAssets(backendDir: string): void {
  const assetsDir = join(backendDir, 'assets')
  cpSync(join(repoRoot, 'packages', 'db', 'src', 'migrations-sqlite'), join(assetsDir, 'migrations-sqlite'), {
    recursive: true,
  })
  const instructionsRoot = join(repoRoot, 'packages', 'instructions')
  for (const contentDir of ['session-instructions', 'tool-descriptions', 'notebooks']) {
    cpSync(join(instructionsRoot, contentDir), join(assetsDir, 'instructions', contentDir), {
      recursive: true,
    })
  }
}

function copyWebUi(skipWebBuild: boolean): void {
  if (!skipWebBuild) run('pnpm', ['--filter', '@vynel/local-web', 'build'], repoRoot)
  const webDist = join(repoRoot, 'apps', 'local-web', 'dist')
  if (!existsSync(join(webDist, 'index.html'))) {
    throw new Error(`No built web UI at ${webDist} — run without --skip-web or build local-web first.`)
  }
  cpSync(webDist, join(payloadDir, 'web'), { recursive: true })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const target = resolvePayloadTarget(args.find((arg) => !arg.startsWith('--')))
  const skipWebBuild = args.includes('--skip-web')

  console.log(`build-payload: target ${target.id} → ${payloadDir}`)
  rmSync(payloadDir, { recursive: true, force: true })
  const backendDir = join(payloadDir, 'backend')
  mkdirSync(join(backendDir, 'dist'), { recursive: true })

  await bundleBackend(backendDir)
  installThirdPartyDependencies(backendDir, target)
  copyAssets(backendDir)
  copyWebUi(skipWebBuild)
  const stagedNode = await stageNodeRuntime({ target, cacheDir: nodeCacheDir, payloadDir })

  console.log(`build-payload: done — runtime staged at ${stagedNode}`)
  console.log('build-payload: next, run verify-payload.ts against this payload.')
}

main().catch((err) => {
  console.error('build-payload failed:', err)
  process.exitCode = 1
})
