// Phase A of docs/release-plan.md: assemble the compiled backend payload.
//
//   tsx scripts/src/release/build-payload.ts [win-x64|linux-x64|linux-arm64] [--skip-web]
//
// Output (win-x64 → apps/desktop/src-tauri/payload/, the dir tauri bundles;
// linux targets → dist-payloads/<target>/ so a server build never clobbers it):
//   backend/dist/server.mjs        ALL @vynel code, esbuild-bundled + minified
//   backend/dist/*.ps1             runtime helper scripts (win-x64 only)
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
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectBackendThirdPartyDependencies } from './collect-backend-dependencies.js'
import { expectedNativeBinaryFormat, readNativeBinaryFormat } from './native-binary-format.js'
import { resolvePayloadDir, resolvePayloadTarget, type PayloadTarget } from './payload-targets.js'
import { formatPruneReport, prunePayloadNodeModules } from './prune-payload.js'
import { stageNodeRuntime } from './stage-node-runtime.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const nodeCacheDir = join(repoRoot, '.cache', 'node-runtimes')

function run(command: string, args: string[], cwd: string, extraEnv?: Record<string, string>): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: extraEnv === undefined ? process.env : { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}.`)
  }
}

async function bundleBackend(backendDir: string, sourcemapDir: string, target: PayloadTarget): Promise<void> {
  const distDir = join(backendDir, 'dist')
  await build({
    // Two entries, one bundle pass: the daemon (server.mjs) and the remote-
    // mode tunnel (tunnel.mjs) the shell spawns instead of it (Phase D3).
    entryPoints: [
      join(repoRoot, 'apps', 'local-api', 'src', 'server.ts'),
      join(repoRoot, 'apps', 'local-api', 'src', 'tunnel.ts'),
    ],
    outdir: distDir,
    outExtension: { '.js': '.mjs' },
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
  for (const entryName of ['server', 'tunnel']) {
    renameSync(join(distDir, `${entryName}.mjs.map`), join(sourcemapDir, `${entryName}.mjs.map`))
  }

  // notification-listener.ps1 is resolved beside its compiled module at
  // runtime — in the bundle that means beside server.mjs. Windows-only:
  // desktop-control never boots off-Windows (boot.ts guards on resolveDesktopOs).
  if (target.os === 'win32') {
    cpSync(
      join(repoRoot, 'packages', 'desktop-control', 'src', 'notifications', 'notification-listener.ps1'),
      join(backendDir, 'dist', 'notification-listener.ps1'),
    )
  }
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
      // The side-effects cache replays install-script OUTPUT keyed by the
      // HOST — a cross-build would receive the win32 better_sqlite3.node the
      // desktop build compiled instead of fetching the target's prebuild.
      'sideEffectsCache: false',
      'supportedArchitectures:',
      `  os: ["${target.os}"]`,
      `  cpu: ["${target.cpu}"]`,
      ...(target.libc !== undefined ? [`  libc: ["${target.libc}"]`] : []),
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
  // Install scripts resolve prebuilds against npm_config_platform/arch, not
  // supportedArchitectures (which only selects optional-dep platform packages)
  // — without these, better-sqlite3's prebuild-install would fetch for the
  // HOST and a win32 binary would land in a linux payload.
  run('pnpm', ['install', '--prod'], backendDir, {
    npm_config_platform: target.os,
    npm_config_arch: target.cpu,
    ...(target.libc !== undefined ? { npm_config_libc: target.libc } : {}),
  })
}

// Deps whose install script is `prebuild-install || node-gyp rebuild`. In a
// cross-build pnpm can hand them a HOST binary (its side-effects cache is
// keyed by the host and skips the script even when the cache flag is off —
// observed with better-sqlite3), so the prebuild for the TARGET is fetched
// explicitly whenever the shipped binary doesn't match.
const PREBUILD_INSTALL_DEPENDENCIES = [
  { packageName: 'better-sqlite3', binaryPath: join('build', 'Release', 'better_sqlite3.node') },
]

function repairCrossBuiltNatives(backendDir: string, target: PayloadTarget): void {
  const nodeModulesDir = join(backendDir, 'node_modules')
  const expected = expectedNativeBinaryFormat(target)
  for (const { packageName, binaryPath } of PREBUILD_INSTALL_DEPENDENCIES) {
    const packageDir = join(nodeModulesDir, packageName)
    const shippedBinary = join(packageDir, binaryPath)
    if (existsSync(shippedBinary) && readNativeBinaryFormat(shippedBinary) === expected) continue
    console.log(`build-payload: fetching ${target.id} prebuild for ${packageName}`)
    run(
      'node',
      [join(nodeModulesDir, 'prebuild-install', 'bin.js'), `--platform=${target.os}`, `--arch=${target.cpu}`],
      packageDir,
    )
  }
}

// Optional native accelerators whose install scripts compile via node-gyp —
// which always targets the HOST toolchain. In a cross-build they produce a
// foreign binary; deleting it is safe (each has a pure-JS fallback).
const OPTIONAL_NATIVE_MARKERS = ['cpu-features', 'sshcrypto.node']

/**
 * Every `.node` addon in the payload must match the target's binary format.
 * Foreign optional accelerators are removed (JS fallback takes over); a
 * foreign REQUIRED native is a broken payload and fails the build loudly.
 */
function sweepForeignNativeBinaries(nodeModulesDir: string, target: PayloadTarget): void {
  const expected = expectedNativeBinaryFormat(target)
  const foreignRequired: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        // The agent SDK owns its layout (prune-payload precedent) — its
        // per-platform binary is verified separately by verify-payload.
        if (entry.name.startsWith('claude-agent-sdk')) continue
        walk(entryPath)
        continue
      }
      if (!entry.name.endsWith('.node')) continue
      if (readNativeBinaryFormat(entryPath) === expected) continue
      if (OPTIONAL_NATIVE_MARKERS.some((marker) => entryPath.includes(marker))) {
        console.log(`build-payload: removing host-built optional native ${entryPath}`)
        rmSync(entryPath, { force: true })
        continue
      }
      foreignRequired.push(entryPath)
    }
  }
  walk(nodeModulesDir)
  if (foreignRequired.length > 0) {
    throw new Error(
      `Native binaries built for the wrong platform (expected ${expected}):\n - ${foreignRequired.join('\n - ')}\n` +
        'A prebuild download likely failed and node-gyp compiled for the host instead.',
    )
  }
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

function copyWebUi(payloadDir: string, skipWebBuild: boolean): void {
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
  const payloadDir = resolvePayloadDir(repoRoot, target)
  const sourcemapDir = join(payloadDir, '..', target.os === 'win32' ? 'payload-sourcemaps' : `${target.id}-sourcemaps`)

  console.log(`build-payload: target ${target.id} → ${payloadDir}`)
  rmSync(payloadDir, { recursive: true, force: true })
  const backendDir = join(payloadDir, 'backend')
  mkdirSync(join(backendDir, 'dist'), { recursive: true })

  await bundleBackend(backendDir, sourcemapDir, target)
  installThirdPartyDependencies(backendDir, target)
  repairCrossBuiltNatives(backendDir, target)
  const pruneReport = prunePayloadNodeModules(backendDir, target)
  console.log(`build-payload: pruned dead weight — ${formatPruneReport(pruneReport)}`)
  // After the prune: what remains is exactly what the runtime can load, so
  // every surviving addon must match the target's binary format.
  sweepForeignNativeBinaries(join(backendDir, 'node_modules'), target)
  copyAssets(backendDir)
  copyWebUi(payloadDir, skipWebBuild)
  const stagedNode = await stageNodeRuntime({ target, cacheDir: nodeCacheDir, payloadDir })

  console.log(`build-payload: done — runtime staged at ${stagedNode}`)
  console.log('build-payload: next, run verify-payload.ts against this payload.')
}

main().catch((err) => {
  console.error('build-payload failed:', err)
  process.exitCode = 1
})
