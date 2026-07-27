// Phase B of docs/release-plan.md: the Windows installer, end to end.
//
//   tsx scripts/src/release/build-desktop.ts [--skip-web] [--skip-payload]
//
// payload → verify → stage the runtime as tauri's externalBin → bake
// release.env (when a hub is configured in the build env) → `tauri build`
// with the release overlay config (the base tauri.conf.json stays
// bundle-inactive so dev cargo builds never demand a staged payload).
//
// Output: apps/desktop/src-tauri/target/release/bundle/nsis/Vynel_<v>_x64-setup.exe

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const srcTauriDir = join(repoRoot, 'apps', 'desktop', 'src-tauri')
const payloadDir = join(srcTauriDir, 'payload')

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}.`)
  }
}

function stageExternalBinRuntime(): void {
  // Tauri's externalBin naming: <name>-<target-triple><ext>, renamed to
  // node.exe beside Vynel.exe at install time — where launch_plan.rs expects it.
  const binariesDir = join(srcTauriDir, 'binaries')
  mkdirSync(binariesDir, { recursive: true })
  cpSync(join(payloadDir, 'node.exe'), join(binariesDir, 'node-x86_64-pc-windows-msvc.exe'))
}

function bakeReleaseEnv(): void {
  const hubUrl = process.env['VYNEL_HUB_URL']
  const hubPublicKey = process.env['VYNEL_HUB_PUBLIC_KEY']
  const configDir = join(payloadDir, 'backend', 'config')
  mkdirSync(configDir, { recursive: true })
  if ((hubUrl === undefined) !== (hubPublicKey === undefined)) {
    // Exactly one of the pair is always a build-env mistake — mirroring
    // env.ts's own superRefine. A silent hub-less installer would ship broken.
    throw new Error(
      'Half-configured hub build env: set BOTH VYNEL_HUB_URL and VYNEL_HUB_PUBLIC_KEY, or neither.',
    )
  }
  if (hubUrl === undefined || hubPublicKey === undefined) {
    // A previously baked release.env must not survive a --skip-payload
    // hub-less rebuild — remove it so the log line below tells the truth.
    rmSync(join(configDir, 'release.env'), { force: true })
    console.log('build-desktop: no VYNEL_HUB_URL/VYNEL_HUB_PUBLIC_KEY in the build env — hub-less build.')
    return
  }
  // Public values only, by design: the hub URL and the hub's PUBLIC key.
  writeFileSync(
    join(configDir, 'release.env'),
    `VYNEL_HUB_URL=${hubUrl}\nVYNEL_HUB_PUBLIC_KEY=${hubPublicKey}\n`,
  )
  console.log(`build-desktop: baked release.env (hub ${hubUrl})`)
}

function printInstallerPath(): void {
  const nsisDir = join(srcTauriDir, 'target', 'release', 'bundle', 'nsis')
  const installers = existsSync(nsisDir)
    ? readdirSync(nsisDir).filter((name) => name.endsWith('-setup.exe'))
    : []
  if (installers.length === 0) {
    throw new Error(`tauri build finished but no *-setup.exe found in ${nsisDir}.`)
  }
  for (const installer of installers) {
    console.log(`build-desktop: installer → ${join(nsisDir, installer)}`)
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const passthrough = args.includes('--skip-web') ? ['--skip-web'] : []

  if (!args.includes('--skip-payload')) {
    run('tsx', [join(here, 'build-payload.ts'), 'win-x64', ...passthrough], repoRoot)
  } else if (!existsSync(join(payloadDir, 'backend', 'dist', 'server.mjs'))) {
    throw new Error('--skip-payload passed but no payload exists — run build-payload first.')
  }
  run('tsx', [join(here, 'verify-payload.ts'), 'win-x64'], repoRoot)

  stageExternalBinRuntime()
  bakeReleaseEnv()
  run(
    'pnpm',
    ['--filter', '@vynel/desktop', 'exec', 'tauri', 'build', '--config', join(srcTauriDir, 'tauri.release.conf.json')],
    repoRoot,
  )
  printInstallerPath()
}

try {
  main()
} catch (err) {
  console.error('build-desktop failed:', err)
  process.exitCode = 1
}
