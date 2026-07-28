// Remote-mode entry (Phase D3) — what the shell spawns INSTEAD of server.ts
// when the engine runs on the user's server. Opens the local DB read-only-ish
// (no migrations — the local daemon owns those), unseals the install's
// credential + bearer with the machine master key, and holds the SSH tunnel:
// a local listener on the ENGINE port forwarding to the remote daemon's
// loopback with the bearer injected. The shell supervises this process
// exactly like the daemon child; the whole web/SDK/window layer is untouched.

import pino, { type Logger } from 'pino'
import { createDatabase } from '@vynel/db'
import { createFileMasterKeyVault, openSecret, resolveMasterKey } from '@vynel/sealing'
import {
  findLatestInstalledServerInstall,
  findServerInstallById,
  startEngineTunnel,
  type ServerCredentials,
} from '@vynel/server-install'
import { VYNEL_ENGINE_PORT } from '@vynel/contracts/network/ports'
import { loadEnv } from './env.js'

async function main(): Promise<void> {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })

  const db = createDatabase({
    dialect: env.DB_DIALECT,
    ...(env.DB_PATH !== undefined ? { path: env.DB_PATH } : {}),
    ...(env.DB_URL !== undefined ? { url: env.DB_URL } : {}),
  })

  const install =
    env.VYNEL_REMOTE_INSTALL_ID !== undefined
      ? findServerInstallById(db, env.VYNEL_REMOTE_INSTALL_ID)
      : findLatestInstalledServerInstall(db)
  if (install === null || install.status !== 'installed') {
    throw new Error(
      'No healthy remote engine install found — provision one first (Settings → Engine), or switch back to local mode.',
    )
  }

  // Desktop machine: the keyring vault unless a file vault is configured
  // (mirrors boot.ts; the import stays dynamic for dev laziness).
  const masterKeyVault =
    env.VYNEL_MASTER_KEY_FILE !== undefined
      ? createFileMasterKeyVault(env.VYNEL_MASTER_KEY_FILE)
      : (await import('@vynel/sealing/keyring')).createKeyringMasterKeyVault()
  const masterKey = resolveMasterKey(masterKeyVault)

  const credentials = JSON.parse(openSecret(masterKey, install.encryptedCredentials)) as ServerCredentials
  const tunnel = await startEngineTunnel({
    host: install.host,
    port: install.port,
    username: install.username,
    credentials,
    pinnedHostKeyFingerprint: install.hostKeyFingerprint,
    authToken: openSecret(masterKey, install.sealedAuthToken),
    localPort: env.PORT,
    remotePort: VYNEL_ENGINE_PORT,
    logger,
  })
  logger.info(
    { installId: install.id, host: install.host, localPort: tunnel.localPort },
    'remote engine tunnel up',
  )

  // Version handshake (Phase D5): the shell and the remote engine can drift —
  // the user updates the desktop app, the server keeps its old engine. Report
  // it loudly at connect; the fix is "Update engine" in the settings surface
  // (re-provisions with the payload this shell ships).
  await reportVersionDrift(tunnel.localPort, env.VYNEL_APP_VERSION, logger)

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'tunnel shutdown')
    void tunnel.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function reportVersionDrift(
  localPort: number,
  shellVersion: string | undefined,
  logger: Logger,
): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${localPort}/health`, {
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await response.json()) as { version?: string }
    const remoteVersion = body.version ?? 'unknown'
    if (shellVersion !== undefined && remoteVersion !== shellVersion) {
      logger.warn(
        { remoteVersion, shellVersion },
        'remote engine version differs from this app — update the engine from Settings → Where Vynel runs',
      )
      return
    }
    logger.info({ remoteVersion }, 'remote engine version matches this app')
  } catch (error) {
    // A handshake we could not complete must never stop the tunnel — the
    // engine may still be starting, and the app is usable either way.
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'could not read the remote engine version',
    )
  }
}

main().catch((err) => {
  // Pino may not be wired before crash — console mirrors server.ts's bootstrap path.
  // eslint-disable-next-line no-console -- pre-pino bootstrap failure
  console.error('tunnel boot failed:', err)
  // eslint-disable-next-line n/no-process-exit -- boot-failure exit
  process.exit(1)
})
