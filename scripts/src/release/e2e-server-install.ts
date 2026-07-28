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
import {
  startServerInstall,
  runProvision,
  findServerInstallById,
} from '@vynel/server-install'

function arg(name: string): string {
  const match = process.argv.find((candidate) => candidate.startsWith(`--${name}=`))
  if (match === undefined) throw new Error(`Missing --${name}=`)
  return match.slice(name.length + 3)
}

async function main(): Promise<void> {
  const password = process.env['VYNEL_E2E_SSH_PASSWORD']
  if (password === undefined || password.length === 0) {
    throw new Error('Set VYNEL_E2E_SSH_PASSWORD (never pass the password as an argument).')
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
  })
}

main().catch((err) => {
  console.error('e2e-server-install failed:', err)
  process.exitCode = 1
})
