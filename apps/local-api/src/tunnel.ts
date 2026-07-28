// Remote-mode entry (Phase D3) — what the shell spawns INSTEAD of server.ts
// when the engine runs on the user's server. Opens the local DB read-only-ish
// (no migrations — the local daemon owns those), unseals the install's
// credential + bearer with the machine master key, and holds the SSH tunnel:
// a local listener on the ENGINE port forwarding to the remote daemon's
// loopback with the bearer injected. The shell supervises this process
// exactly like the daemon child; the whole web/SDK/window layer is untouched.

import pino from 'pino'
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

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'tunnel shutdown')
    void tunnel.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  // Pino may not be wired before crash — console mirrors server.ts's bootstrap path.
  // eslint-disable-next-line no-console -- pre-pino bootstrap failure
  console.error('tunnel boot failed:', err)
  // eslint-disable-next-line n/no-process-exit -- boot-failure exit
  process.exit(1)
})
