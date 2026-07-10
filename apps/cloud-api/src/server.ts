// Boots the hub. Boot: loadEnv → migrate over the DIRECT connection (pool of
// one, closed after) → createCloudApp on the pooled client → serve on
// 0.0.0.0:PORT (hosted service behind Chad's reverse proxy — unlike the
// loopback-only local-api). SIGINT/SIGTERM → close server + pool.

import { serve } from '@hono/node-server'
import pino from 'pino'
import { createCloudDatabase, closeCloudDatabase, runCloudMigrations } from '@vynel/cloud-db'
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  createLoggingAccountMailSender,
} from '@vynel/accounts'
import { loadEnv } from './env.js'
import { createCloudApp } from './app.js'
import { createFilesystemArtifactStore } from './artifacts/artifact-store.js'

export async function boot(): Promise<void> {
  const env = loadEnv()
  const logger = pino({ level: env.LOG_LEVEL })

  logger.info({}, 'cloud-api boot: running migrations (direct connection)')
  const directDb = createCloudDatabase({
    url: env.CLOUD_DIRECT_DATABASE_URL ?? env.CLOUD_DATABASE_URL,
    maxConnections: 1,
  })
  await runCloudMigrations(directDb)
  await closeCloudDatabase(directDb)

  const db = createCloudDatabase({ url: env.CLOUD_DATABASE_URL })
  const app = createCloudApp({
    db,
    logger,
    accessTokens: await createAccessTokenIssuer({
      privateKeyPem: env.CLOUD_ACCESS_TOKEN_PRIVATE_KEY,
      ttlSeconds: env.CLOUD_ACCESS_TOKEN_TTL_SECONDS,
    }),
    accessTokenVerifier: await createAccessTokenVerifier({
      publicKeyPem: env.CLOUD_ACCESS_TOKEN_PUBLIC_KEY,
    }),
    entitlements: await createEntitlementTokenIssuer({
      privateKeyPem: env.CLOUD_ACCESS_TOKEN_PRIVATE_KEY,
      keyId: env.CLOUD_TOKEN_KEY_ID,
      ttlSeconds: env.CLOUD_ENTITLEMENT_TTL_SECONDS,
    }),
    ...(env.CLOUD_PLATFORM_WEBHOOK_SECRET !== undefined
      ? { platformWebhookSecret: env.CLOUD_PLATFORM_WEBHOOK_SECRET }
      : {}),
    // The dev fallback: logs set-password links. Swapped for a real provider
    // (Resend/Postmark) at deploy — cloud-api.md §3.
    mail: createLoggingAccountMailSender(logger),
    artifactStore: createFilesystemArtifactStore(env.CLOUD_ARTIFACT_DIR),
    linkBaseUrl: env.CLOUD_PUBLIC_BASE_URL,
    adminToken: env.CLOUD_ADMIN_TOKEN,
  })

  const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: env.CLOUD_PORT }, (info) => {
    logger.info({ port: info.port }, 'cloud-api listening')
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'cloud-api shutdown initiated')
    server.close(() => {
      void closeCloudDatabase(db).then(() => {
        logger.info({}, 'cloud-api shutdown complete')
        // eslint-disable-next-line n/no-process-exit -- explicit exit at the end of a graceful shutdown
        process.exit(0)
      })
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

boot().catch((err) => {
  // Pino may not be wired before crash — console so the operator sees it.
  // eslint-disable-next-line no-console -- pre-pino bootstrap failure
  console.error('cloud-api boot failed:', err)
  // eslint-disable-next-line n/no-process-exit -- boot-failure exit
  process.exit(1)
})
