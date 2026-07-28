// MANUAL end-to-end proof for Phase D2: provision a REAL server (WSL sshd, a
// VPS) with the packed linux payload through the real leaf pipeline, then
// print the resulting row. Not part of `pnpm test` — the vitest suite proves
// the pipeline against a loopback fake; this proves it against real sshd +
// systemd + the real engine.
//
//   VYNEL_E2E_SSH_PASSWORD=... pnpm tsx scripts/src/release/e2e-server-install.ts \
//     --host=127.0.0.1 --port=2222 --user=vyneltest --archive=dist-payloads/vynel-engine-linux-x64-0.1.1.tar.gz

import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { openSecret } from '@vynel/sealing'
import {
  startServerInstall,
  runProvision,
  findServerInstallById,
  startEngineTunnel,
  type ServerCredentials,
} from '@vynel/server-install'
import { VYNEL_ENGINE_PORT } from '@vynel/contracts/network/ports'

function arg(name: string): string {
  const match = process.argv.find((candidate) => candidate.startsWith(`--${name}=`))
  if (match === undefined) throw new Error(`Missing --${name}=`)
  return match.slice(name.length + 3)
}

// --tunnel-only: skip provisioning entirely — open the bearer-injecting
// tunnel to an ALREADY-provisioned engine (bearer via VYNEL_E2E_BEARER, e.g.
// read from the server's ~/.vynel/engine.env) and round-trip through it.
async function tunnelOnly(password: string): Promise<void> {
  const bearer = process.env['VYNEL_E2E_BEARER']
  if (bearer === undefined || bearer.length === 0) {
    throw new Error('Set VYNEL_E2E_BEARER for --tunnel-only (the engine.env VYNEL_AUTH_TOKEN value).')
  }
  const tunnel = await startEngineTunnel({
    host: arg('host'),
    port: Number(arg('port')),
    username: arg('user'),
    credentials: { authKind: 'password', password },
    // KNOWN NARROWING (dev script only): tunnel-only mode has no install row
    // to pin from, so the first connect trusts whatever answers — fine for
    // the loopback fixture, NOT a pattern for product code (the real tunnel
    // entry always pins from the row).
    pinnedHostKeyFingerprint: null,
    authToken: bearer,
    localPort: 0,
    remotePort: VYNEL_ENGINE_PORT,
  })
  try {
    const health = await fetch(`http://127.0.0.1:${tunnel.localPort}/health`)
    console.log(`e2e: tunnel /health → ${health.status} ${await health.text()}`)
    const api = await fetch(`http://127.0.0.1:${tunnel.localPort}/api/workspaces`)
    console.log(`e2e: tunnel /api/workspaces (bearer auto-injected) → ${api.status}`)
    const index = await fetch(`http://127.0.0.1:${tunnel.localPort}/`, {
      headers: { accept: 'text/html' },
    })
    console.log(`e2e: tunnel / (web ui) → ${index.status} ${index.headers.get('content-type') ?? ''}`)
  } finally {
    await tunnel.close()
  }
}

async function main(): Promise<void> {
  const password = process.env['VYNEL_E2E_SSH_PASSWORD']
  if (password === undefined || password.length === 0) {
    throw new Error('Set VYNEL_E2E_SSH_PASSWORD (never pass the password as an argument).')
  }
  if (process.argv.includes('--tunnel-only')) {
    await tunnelOnly(password)
    return
  }
  const archivePath = resolve(arg('archive'))
  const sha256 = readFileSync(`${archivePath}.sha256`, 'utf8').trim().split(/\s+/)[0] ?? ''
  const masterKeyBase64 = randomBytes(32).toString('base64')

  await withTestDatabase(async (db) => {
    const now = new Date()
    const user = insertUser(db, {
      id: randomUUID(),
      displayName: 'E2E',
      emailAddress: null,
      locale: 'en-US',
      timezone: 'UTC',
      hasCompletedOnboarding: false,
      createdAt: now,
      updatedAt: now,
    })
    const install = startServerInstall(
      db,
      {
        userId: user.id,
        host: arg('host'),
        port: Number(arg('port')),
        username: arg('user'),
        credentials: { authKind: 'password', password },
      },
      { masterKeyBase64 },
    )
    console.log(`e2e: provisioning install ${install.id} → ${arg('user')}@${arg('host')}:${arg('port')}`)
    const startedAt = Date.now()
    try {
      await runProvision(db, install.id, {
        masterKeyBase64,
        appVersion: '0.1.1',
        payloadArchive: { path: archivePath, sha256, cpu: archivePath.includes('arm64') ? 'arm64' : 'x64' },
        logger: {
          info: (ctx, msg) => console.log(`e2e:   ${msg}`, ctx),
          warn: (ctx, msg) => console.warn(`e2e:   WARN ${msg}`, ctx),
          error: (ctx, msg) => console.error(`e2e:   ERROR ${msg}`, ctx),
        },
      })
    } finally {
      const row = findServerInstallById(db, install.id)
      console.log(
        `e2e: ${Math.round((Date.now() - startedAt) / 1000)}s — status=${row?.status} step=${row?.step} ` +
          `version=${row?.installedVersion} error=${row?.errorMessage ?? 'none'}`,
      )
    }

    // --tunnel: prove the D3 leg too — open the bearer-injecting tunnel to
    // the engine just provisioned and round-trip through it.
    if (process.argv.includes('--tunnel')) {
      const row = findServerInstallById(db, install.id)
      if (row === null || row.status !== 'installed') throw new Error('no installed row to tunnel to')
      const tunnel = await startEngineTunnel({
        host: row.host,
        port: row.port,
        username: row.username,
        credentials: JSON.parse(openSecret(masterKeyBase64, row.encryptedCredentials)) as ServerCredentials,
        pinnedHostKeyFingerprint: row.hostKeyFingerprint,
        authToken: openSecret(masterKeyBase64, row.sealedAuthToken),
        localPort: 0,
        remotePort: VYNEL_ENGINE_PORT,
      })
      try {
        const health = await fetch(`http://127.0.0.1:${tunnel.localPort}/health`)
        console.log(`e2e: tunnel /health → ${health.status} ${await health.text()}`)
        const api = await fetch(`http://127.0.0.1:${tunnel.localPort}/api/workspaces`)
        // 412 = the first-launch gate on the fresh remote DB — the bearer the
        // tunnel injected passed the 401 wall and reached the real app.
        console.log(`e2e: tunnel /api/workspaces (bearer auto-injected) → ${api.status}`)
        const index = await fetch(`http://127.0.0.1:${tunnel.localPort}/`)
        console.log(`e2e: tunnel / (web ui) → ${index.status} ${index.headers.get('content-type') ?? ''}`)
      } finally {
        await tunnel.close()
      }
    }
  })
}

main().catch((err) => {
  console.error('e2e-server-install failed:', err)
  process.exitCode = 1
})
