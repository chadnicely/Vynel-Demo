// Phase B of docs/release-plan.md: the Windows installer, end to end.
//
//   tsx scripts/src/release/build-desktop.ts [--skip-web] [--skip-payload] [--publish]
//
// payload → verify → bake release.env (when a hub is configured in the build
// env) → `tauri build` with the release overlay config (the base
// tauri.conf.json stays bundle-inactive so dev cargo builds never demand a
// staged payload) → emit latest.json beside the installer → with --publish,
// push the release (installer + latest.json) to the public vynel-releases
// repo via `gh`. The runtime (payload/vynel-engine.exe) rides the resources
// map into resources\engine — no externalBin staging step anymore.
//
// Signing: TAURI_SIGNING_PRIVATE_KEY(_PATH) must be set for updater
// artifacts; the key itself must NEVER be in the repo — this script refuses
// to run if it finds one.
//
// Output: apps/desktop/src-tauri/target/release/bundle/nsis/Vynel_<v>_x64-setup.exe

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rcedit } from 'rcedit'
import { quoteArgsForShell } from '../quote-for-shell.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const srcTauriDir = join(repoRoot, 'apps', 'desktop', 'src-tauri')
const payloadDir = join(srcTauriDir, 'payload')

function run(command: string, args: string[], cwd: string): void {
  // shell: true (needed for the .cmd shims) joins args UNQUOTED — quote here,
  // once, so a spaced path can never silently split into two arguments.
  const result = spawnSync(command, quoteArgsForShell(args), {
    cwd,
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}.`)
  }
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

// ── Authenticode signing seam (G2) ──────────────────────────────────────────
// Credential-gated: with the full six-variable env present the build signs
// (Azure Artifact Signing via artifact-signing-cli in bundle.windows
// .signCommand — Tauri signs Vynel.exe, the NSIS installer AND uninstaller);
// with none it builds unsigned for internal testing. The engine exe is a
// RESOURCE, which Tauri never signs — so when signing is on, this script
// rebrands it (rcedit: "Vynel Engine" in Task Manager, our icon) and signs it
// itself. Unsigned builds skip the rebrand too: rcedit would invalidate the
// OpenJS signature the renamed node.exe still carries.

type SigningEnv = { endpoint: string; account: string; profile: string }

const SIGNING_ENV_NAMES = [
  'VYNEL_SIGN_ENDPOINT', // e.g. https://eus.codesigning.azure.net
  'VYNEL_SIGN_ACCOUNT', // the Artifact Signing account name
  'VYNEL_SIGN_PROFILE', // the certificate profile name
  'AZURE_CLIENT_ID', // service principal with the profile-signer role
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_SECRET',
] as const

function resolveSigningEnv(): SigningEnv | null {
  const missing = SIGNING_ENV_NAMES.filter((name) => process.env[name] === undefined)
  if (missing.length === SIGNING_ENV_NAMES.length) {
    console.log('build-desktop: no signing env — UNSIGNED build (internal testing only).')
    return null
  }
  if (missing.length > 0) {
    throw new Error(
      `Half-configured signing env: missing ${missing.join(', ')}. Set all of ` +
        `${SIGNING_ENV_NAMES.join(', ')}, or none for an unsigned build.`,
    )
  }
  return {
    endpoint: process.env['VYNEL_SIGN_ENDPOINT']!,
    account: process.env['VYNEL_SIGN_ACCOUNT']!,
    profile: process.env['VYNEL_SIGN_PROFILE']!,
  }
}

function signCommandTemplate(signing: SigningEnv): string {
  // %1 is Tauri's file-path placeholder; the CLI reads AZURE_* from the env
  // and timestamps against Microsoft's TSA by default.
  return `artifact-signing-cli -e ${signing.endpoint} -a ${signing.account} -c ${signing.profile} %1`
}

/** The generated signing overlay (second --config): keeps signCommand out of
 *  the committed release conf so credential-less builds stay green. */
function writeSigningOverlay(signing: SigningEnv): string {
  const overlayPath = join(srcTauriDir, 'target', 'tauri.signing.generated.conf.json')
  mkdirSync(dirname(overlayPath), { recursive: true })
  writeFileSync(
    overlayPath,
    `${JSON.stringify(
      { bundle: { windows: { signCommand: signCommandTemplate(signing) } } },
      null,
      2,
    )}\n`,
  )
  return overlayPath
}

/** Hub-configured builds poll the hub first — channels, staged rollout, and
 *  rollback pointers all live server-side then — with the GitHub manifest as
 *  fallback entry #2 (the updater walks the array in order). Hub-less builds
 *  keep the GitHub-only endpoint baked in the committed release conf. The
 *  {{target}}/{{arch}}/{{current_version}} placeholders are substituted by
 *  the updater plugin client-side. */
function writeUpdaterEndpointsOverlay(hubUrl: string): string {
  const overlayPath = join(srcTauriDir, 'target', 'tauri.endpoints.generated.conf.json')
  mkdirSync(dirname(overlayPath), { recursive: true })
  writeFileSync(
    overlayPath,
    `${JSON.stringify(
      {
        plugins: {
          updater: {
            endpoints: [
              `${hubUrl}/releases/desktop/{{target}}/{{arch}}/{{current_version}}`,
              `https://github.com/${RELEASES_REPO}/releases/latest/download/latest.json`,
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
  )
  return overlayPath
}

async function rebrandAndSignEngine(signing: SigningEnv, version: string): Promise<void> {
  const enginePath = join(payloadDir, 'vynel-engine.exe')
  await rcedit(enginePath, {
    'version-string': {
      FileDescription: 'Vynel Engine',
      ProductName: 'Vynel',
      CompanyName: 'Vynel',
      OriginalFilename: 'vynel-engine.exe',
      LegalCopyright: '© 2026 Vynel',
    },
    'file-version': version,
    'product-version': version,
    icon: join(srcTauriDir, 'icons', 'icon.ico'),
  })
  const [bin, ...commandArgs] = signCommandTemplate(signing).split(' ')
  // %1 swaps at the ARGUMENT level — run() itself quotes spaced paths.
  run(bin!, commandArgs.map((arg) => (arg === '%1' ? enginePath : arg)), repoRoot)
  console.log('build-desktop: engine exe rebranded ("Vynel Engine") and signed.')
}

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

// The linux SERVER payload rides the same release as the desktop installer, so
// one version tag carries every artifact a shell of that version can need:
// its own installer AND the engine it provisions onto a user's server (Phase
// D5). Built by `release:payload linux-x64` + `release:pack linux-x64`;
// absent = a desktop-only release (logged, never a silent omission).
function serverPayloadArtifacts(version: string): string[] {
  const archivePath = join(repoRoot, 'dist-payloads', `vynel-engine-linux-x64-${version}.tar.gz`)
  if (!existsSync(archivePath)) {
    console.log(
      `build-desktop: NO linux server payload for ${version} — publishing desktop-only. ` +
        `Run \`pnpm release:payload linux-x64 && pnpm release:pack linux-x64\` to include it.`,
    )
    return []
  }
  const sidecarPath = `${archivePath}.sha256`
  if (!existsSync(sidecarPath)) {
    throw new Error(`${archivePath} has no .sha256 sidecar — re-run \`pnpm release:pack linux-x64\`.`)
  }
  console.log(`build-desktop: including linux server payload → ${archivePath}`)
  return [archivePath, sidecarPath]
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
      ...serverPayloadArtifacts(version),
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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const passthrough = args.includes('--skip-web') ? ['--skip-web'] : []
  const version = appVersion()

  assertSigningEnvSafe()
  const signing = resolveSigningEnv()
  if (!args.includes('--skip-payload')) {
    run('tsx', [join(here, 'build-payload.ts'), 'win-x64', ...passthrough], repoRoot)
  } else if (!existsSync(join(payloadDir, 'backend', 'dist', 'server.mjs'))) {
    throw new Error('--skip-payload passed but no payload exists — run build-payload first.')
  }
  // Rebrand + sign BEFORE the verify gate, so verify's PE-magic check and
  // smoke boot prove the exact binary that ships — not a pre-mutation one.
  if (signing !== null) {
    await rebrandAndSignEngine(signing, version)
  }
  run('tsx', [join(here, 'verify-payload.ts'), 'win-x64'], repoRoot)

  bakeReleaseEnv()
  // A stale installer from a previous build must not survive to mask a failed
  // one — the artifact asserts below only mean something on a clean dir.
  rmSync(nsisDir, { recursive: true, force: true })
  const configFlags = ['--config', join(srcTauriDir, 'tauri.release.conf.json')]
  if (signing !== null) {
    configFlags.push('--config', writeSigningOverlay(signing))
  }
  // bakeReleaseEnv above already rejected a half-configured hub pair.
  const hubUrl = process.env['VYNEL_HUB_URL']
  if (hubUrl !== undefined) {
    configFlags.push('--config', writeUpdaterEndpointsOverlay(hubUrl))
  }
  run(
    'pnpm',
    ['--filter', '@vynel/desktop', 'exec', 'tauri', 'build', ...configFlags],
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
  await main()
} catch (err) {
  console.error('build-desktop failed:', err)
  process.exitCode = 1
}
