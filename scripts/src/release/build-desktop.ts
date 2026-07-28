// Phase B of docs/release-plan.md: the Windows installer, end to end.
//
//   tsx scripts/src/release/build-desktop.ts [--skip-web] [--skip-payload] [--publish]
//
// payload → verify → stage the runtime as tauri's externalBin → bake
// release.env (when a hub is configured in the build env) → `tauri build`
// with the release overlay config (the base tauri.conf.json stays
// bundle-inactive so dev cargo builds never demand a staged payload) →
// emit latest.json beside the installer → with --publish, push the release
// (installer + latest.json) to the public vynel-releases repo via `gh`.
//
// Signing: TAURI_SIGNING_PRIVATE_KEY(_PATH) must be set for updater
// artifacts; the key itself must NEVER be in the repo — this script refuses
// to run if it finds one.
//
// Output: apps/desktop/src-tauri/target/release/bundle/nsis/Vynel_<v>_x64-setup.exe

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const srcTauriDir = join(repoRoot, 'apps', 'desktop', 'src-tauri')
const payloadDir = join(srcTauriDir, 'payload')

function run(command: string, args: string[], cwd: string): void {
  // shell: true (needed for the .cmd shims) joins args UNQUOTED — quote here,
  // once, so a spaced path can never silently split into two arguments.
  const quotedArgs = args.map((arg) =>
    arg.includes(' ') && !arg.startsWith('"') ? `"${arg}"` : arg,
  )
  const result = spawnSync(command, quotedArgs, { cwd, stdio: 'inherit', shell: true })
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

const RELEASES_REPO = 'kafijunior/vynel-releases'
const nsisDir = join(srcTauriDir, 'target', 'release', 'bundle', 'nsis')

function appVersion(): string {
  const config = JSON.parse(readFileSync(join(srcTauriDir, 'tauri.conf.json'), 'utf8')) as {
    version: string
  }
  return config.version
}

function assertSigningEnvSafe(): void {
  // The tauri CLI reads TAURI_SIGNING_PRIVATE_KEY only (the _PATH variant is
  // ignored by the bundler) — the value may be the key CONTENT or a file path.
  const key = process.env['TAURI_SIGNING_PRIVATE_KEY']
  if (key === undefined) {
    throw new Error(
      'No TAURI_SIGNING_PRIVATE_KEY in the build env — updater artifacts cannot be signed. ' +
        'Load the private key (content or file path) from the password manager, never from a repo file.',
    )
  }
  // The private key must never live in the repo — refuse loudly if one does.
  const looksLikePath = existsSync(key)
  if (looksLikePath && resolve(key).toLowerCase().startsWith(repoRoot.toLowerCase())) {
    throw new Error(`TAURI_SIGNING_PRIVATE_KEY points to a file inside the repo (${key}) — move it out.`)
  }
}

function installerArtifacts(version: string): { installerPath: string; signaturePath: string } {
  const installerPath = join(nsisDir, `Vynel_${version}_x64-setup.exe`)
  const signaturePath = `${installerPath}.sig`
  if (!existsSync(installerPath)) {
    throw new Error(`tauri build finished but ${installerPath} is missing.`)
  }
  if (!existsSync(signaturePath)) {
    throw new Error(`${signaturePath} missing — was TAURI_SIGNING_PRIVATE_KEY set for the build?`)
  }
  return { installerPath, signaturePath }
}

/** The updater manifest the installed app polls from the releases repo. */
function emitLatestManifest(version: string, signaturePath: string): string {
  const manifestPath = join(nsisDir, 'latest.json')
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version,
        pub_date: new Date().toISOString(),
        platforms: {
          'windows-x86_64': {
            signature: readFileSync(signaturePath, 'utf8').trim(),
            url: `https://github.com/${RELEASES_REPO}/releases/download/v${version}/Vynel_${version}_x64-setup.exe`,
          },
        },
      },
      null,
      2,
    )}\n`,
  )
  console.log(`build-desktop: manifest → ${manifestPath}`)
  return manifestPath
}

function publishRelease(version: string, installerPath: string, manifestPath: string): void {
  // latest.json must ride the SAME release: the endpoint fetches it via
  // releases/latest/download, so the newest release always self-describes.
  run(
    'gh',
    [
      'release',
      'create',
      `v${version}`,
      installerPath,
      manifestPath,
      '--repo',
      RELEASES_REPO,
      '--title',
      `Vynel ${version}`,
      '--notes',
      `Vynel ${version} — see CHANGELOG.md in the main repo.`,
    ],
    repoRoot,
  )
  console.log(`build-desktop: published v${version} to ${RELEASES_REPO}`)
}

function main(): void {
  const args = process.argv.slice(2)
  const passthrough = args.includes('--skip-web') ? ['--skip-web'] : []
  const version = appVersion()

  assertSigningEnvSafe()
  if (!args.includes('--skip-payload')) {
    run('tsx', [join(here, 'build-payload.ts'), 'win-x64', ...passthrough], repoRoot)
  } else if (!existsSync(join(payloadDir, 'backend', 'dist', 'server.mjs'))) {
    throw new Error('--skip-payload passed but no payload exists — run build-payload first.')
  }
  run('tsx', [join(here, 'verify-payload.ts'), 'win-x64'], repoRoot)

  stageExternalBinRuntime()
  bakeReleaseEnv()
  // A stale installer from a previous build must not survive to mask a failed
  // one — the artifact asserts below only mean something on a clean dir.
  rmSync(nsisDir, { recursive: true, force: true })
  run(
    'pnpm',
    ['--filter', '@vynel/desktop', 'exec', 'tauri', 'build', '--config', join(srcTauriDir, 'tauri.release.conf.json')],
    repoRoot,
  )

  const { installerPath, signaturePath } = installerArtifacts(version)
  const manifestPath = emitLatestManifest(version, signaturePath)
  console.log(`build-desktop: installer → ${installerPath}`)
  if (args.includes('--publish')) {
    publishRelease(version, installerPath, manifestPath)
  } else {
    console.log('build-desktop: dry (no --publish) — nothing pushed to the releases repo.')
  }
}

try {
  main()
} catch (err) {
  console.error('build-desktop failed:', err)
  process.exitCode = 1
}
