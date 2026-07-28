// The provisioning step machine (Phase D2): turn a registered install row
// (start-server-install.ts) into a running remote engine. Each step stamps
// the row before running, so the UI can show live progress by polling, and a
// failure leaves `step` pointing at exactly what broke with an actionable
// `errorMessage`.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError, VynelError } from '@vynel/errors'
import { openSecret } from '@vynel/sealing'
import * as installsRepository from '../repositories/index.js'
import type { ServerInstall, ServerInstallStep } from '../repositories/index.js'
import {
  openServerConnection,
  type ExecResult,
  type OpenServerConnection,
  type ServerConnection,
} from '../connecting/server-connection.js'
import {
  composeEngineEnvFile,
  composeInstallPlan,
  composeSystemdUnit,
  ENGINE_SERVICE_NAME,
  REMOTE_ENGINE_PORT,
} from './install-plan.js'
import { PREFLIGHT_COMMAND, parsePreflightReport } from './preflight.js'
import {
  SERVER_INSTALL_COMPLETED,
  SERVER_INSTALL_FAILED,
  type ServerInstallCompletedPayload,
  type ServerInstallFailedPayload,
} from '../server-install-events.js'
import type { ServerCredentials, StructuralLogger } from '../server-install-types.js'

export interface PayloadArchive {
  path: string
  sha256: string
  cpu: 'x64' | 'arm64'
}

export interface ProvisionDeps {
  masterKeyBase64: string
  appVersion: string
  payloadArchive: PayloadArchive
  openConnection?: OpenServerConnection
  logger?: StructuralLogger
  /** Test overrides for the health poll. */
  healthDeadlineMs?: number
  healthIntervalMs?: number
}

function mustSucceed(result: ExecResult, failureIntro: string): ExecResult {
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(-500)
    // null exit = the channel closed without a code (signal kill, dropped
    // connection) — name it, or the failure reads as a silent mystery.
    const exitLabel = result.exitCode === null ? 'no exit code — killed or disconnected' : `exit ${result.exitCode}`
    throw new Error(`${failureIntro} (${exitLabel})${detail.length > 0 ? ` — ${detail}` : ''}`)
  }
  return result
}

function stampStep(db: Database, installId: string, step: ServerInstallStep): void {
  installsRepository.updateServerInstall(db, installId, { step, updatedAt: new Date() })
}

export async function runProvision(db: Database, installId: string, deps: ProvisionDeps): Promise<void> {
  const install = installsRepository.findServerInstallById(db, installId)
  if (install === null) throw new Error(`runProvision: no install row ${installId}`)
  const connect = deps.openConnection ?? openServerConnection

  let connection: ServerConnection | null = null
  try {
    // Unseal INSIDE the try — a wrong master key must settle the row like any
    // other failure, never strand it in 'provisioning'.
    const credentials = JSON.parse(
      openSecret(deps.masterKeyBase64, install.encryptedCredentials),
    ) as ServerCredentials
    const authToken = openSecret(deps.masterKeyBase64, install.sealedAuthToken)

    stampStep(db, installId, 'connect')
    connection = await connect({
      host: install.host,
      port: install.port,
      username: install.username,
      credentials,
      pinnedHostKeyFingerprint: install.hostKeyFingerprint,
    })
    if (install.hostKeyFingerprint === null) {
      installsRepository.updateServerInstall(db, installId, {
        hostKeyFingerprint: connection.hostKeyFingerprint,
        updatedAt: new Date(),
      })
    }

    stampStep(db, installId, 'preflight')
    const preflight = parsePreflightReport(
      mustSucceed(await connection.exec(PREFLIGHT_COMMAND), 'The server preflight check failed').stdout,
    )
    if (preflight.arch !== deps.payloadArchive.cpu) {
      throw new ValidationError(
        `This server is ${preflight.arch} but the engine payload is ${deps.payloadArchive.cpu} — a matching build is needed.`,
      )
    }
    const plan = composeInstallPlan(preflight.home, preflight.arch)

    stampStep(db, installId, 'upload')
    // Paths are quoted throughout: they derive from the server's own $HOME
    // (no injection surface), but a home with a space must fail cleanly.
    mustSucceed(
      await connection.exec(
        `mkdir -p "${plan.vynelDir}" "${plan.dataDir}" "${preflight.home}/.config/systemd/user"`,
      ),
      'Could not create the install directories',
    )
    await connection.uploadFile(deps.payloadArchive.path, plan.archivePath)
    const shaReport = mustSucceed(
      await connection.exec(`sha256sum "${plan.archivePath}"`),
      'Could not verify the uploaded payload',
    )
    if (!shaReport.stdout.startsWith(deps.payloadArchive.sha256)) {
      throw new Error('The uploaded payload is corrupt (SHA-256 mismatch) — check the connection and retry.')
    }

    stampStep(db, installId, 'install')
    // Extract beside, then swap — a failed extract never destroys a working
    // engine. The stop is best-effort (first installs have no service yet).
    mustSucceed(
      await connection.exec(
        [
          `rm -rf "${plan.engineDir}.tmp"`,
          `mkdir -p "${plan.engineDir}.tmp"`,
          `tar -xzf "${plan.archivePath}" -C "${plan.engineDir}.tmp"`,
          `rm -f "${plan.archivePath}"`,
          `systemctl --user stop ${ENGINE_SERVICE_NAME} 2>/dev/null || true`,
          `rm -rf "${plan.engineDir}"`,
          `mv "${plan.engineDir}.tmp" "${plan.engineDir}"`,
          // NTFS staging can't carry exec bits (D0 learning) — restore them here.
          `chmod 0755 "${plan.nodeBinaryPath}" "${plan.claudeBinaryPath}"`,
        ].join(' && '),
        { timeoutMs: 300_000 },
      ),
      'Could not install the engine payload on the server',
    )
    await connection.writeFile(plan.envFilePath, composeEngineEnvFile(plan, { authToken, appVersion: deps.appVersion }), 0o600)
    await connection.writeFile(plan.unitFilePath, composeSystemdUnit(plan), 0o644)

    stampStep(db, installId, 'start')
    // `systemctl --user` needs the user's runtime bus, and a bare ssh exec
    // channel may carry neither XDG_RUNTIME_DIR nor a running user manager.
    // Linger FIRST (it boots the manager AND keeps the engine alive after
    // the last session ends), wait for the bus socket, then address it
    // explicitly. A linger failure is survivable while sessions exist — warn.
    const uid = mustSucceed(
      await connection.exec('id -u'),
      "Could not resolve the server user's uid",
    ).stdout.trim()
    const linger = await connection.exec('loginctl enable-linger')
    if (linger.exitCode !== 0) {
      deps.logger?.warn(
        { installId, stderr: linger.stderr.slice(0, 200) },
        'enable-linger failed — the engine stops when the last session ends',
      )
    }
    const busEnv = `XDG_RUNTIME_DIR=/run/user/${uid}`
    mustSucceed(
      await connection.exec(
        [
          `for attempt in 1 2 3 4 5; do test -S /run/user/${uid}/bus && break; sleep 1; done`,
          `${busEnv} systemctl --user daemon-reload`,
          `${busEnv} systemctl --user enable --now ${ENGINE_SERVICE_NAME}`,
        ].join(' && '),
        { timeoutMs: 60_000 },
      ),
      'Could not start the engine service',
    )

    stampStep(db, installId, 'health')
    // The engine is started by now — a connection lost in transit (network
    // blip after the heavy upload) must not fail the install at its last
    // step. The probe redials with the pinned host key on a dead connection.
    const pinnedFingerprint = connection.hostKeyFingerprint
    const execProbe = async (command: string): Promise<ExecResult> => {
      try {
        return await connection!.exec(command, { timeoutMs: 10_000 })
      } catch (error) {
        deps.logger?.warn(
          { installId, error: error instanceof Error ? error.message : String(error) },
          'health probe lost the connection — redialing with the pinned host key',
        )
        connection?.close()
        connection = await connect({
          host: install.host,
          port: install.port,
          username: install.username,
          credentials,
          pinnedHostKeyFingerprint: pinnedFingerprint,
        })
        return connection.exec(command, { timeoutMs: 10_000 })
      }
    }
    const health = await pollRemoteHealth(execProbe, plan.nodeBinaryPath, deps)
    const now = new Date()
    withTransaction(db, (tx) => {
      installsRepository.updateServerInstall(tx, installId, {
        status: 'installed',
        errorMessage: null,
        installedVersion: health.version,
        lastHealthyAt: now,
        updatedAt: now,
      })
      const payload: ServerInstallCompletedPayload = {
        installId,
        userId: install.userId,
        host: install.host,
        installedVersion: health.version,
        completedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: SERVER_INSTALL_COMPLETED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    })
    deps.logger?.info({ installId, version: health.version }, 'server install completed')
  } catch (error) {
    recordProvisionFailure(db, installId, error, deps.logger)
    throw error
  } finally {
    connection?.close()
  }
}

async function pollRemoteHealth(
  execProbe: (command: string) => Promise<ExecResult>,
  nodeBinaryPath: string,
  deps: ProvisionDeps,
): Promise<{ version: string | null }> {
  const deadlineMs = deps.healthDeadlineMs ?? 90_000
  const intervalMs = deps.healthIntervalMs ?? 3_000
  // The fetch carries its own timeout AND the exec is bounded — a probe
  // against a still-booting engine must exit, or hung probes pile up open
  // ssh channels until MaxSessions refuses new ones.
  const probe = `"${nodeBinaryPath}" -e "fetch('http://127.0.0.1:${REMOTE_ENGINE_PORT}/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.text()).then(t=>{console.log(t)},()=>process.exit(1))"`
  const startedAt = Date.now()
  let lastFailure = ''
  while (Date.now() - startedAt < deadlineMs) {
    const result = await execProbe(probe)
    if (result.exitCode === 0) {
      try {
        const body = JSON.parse(result.stdout.trim()) as { status?: string; version?: string }
        if (body.status === 'ok') return { version: body.version ?? null }
      } catch {
        // Not JSON yet (proxy hiccup mid-boot) — keep polling until deadline.
      }
    }
    lastFailure = (result.stderr || result.stdout).trim().slice(-200)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs))
  }
  throw new Error(
    `The engine started but never answered its health check${lastFailure.length > 0 ? ` — ${lastFailure}` : ''}. ` +
      `Check the service log on the server: journalctl --user -u ${ENGINE_SERVICE_NAME}.`,
  )
}

function recordProvisionFailure(
  db: Database,
  installId: string,
  error: unknown,
  logger?: StructuralLogger,
): void {
  const install = installsRepository.findServerInstallById(db, installId)
  if (install === null) return
  const message =
    error instanceof VynelError || error instanceof Error
      ? error.message
      : 'Provisioning failed for an unknown reason.'
  const now = new Date()
  withTransaction(db, (tx) => {
    installsRepository.updateServerInstall(tx, installId, {
      status: 'failed',
      errorMessage: message,
      updatedAt: now,
    })
    const payload: ServerInstallFailedPayload = {
      installId,
      userId: install.userId,
      host: install.host,
      step: install.step ?? 'connect',
      failedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: SERVER_INSTALL_FAILED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })
  logger?.error({ installId, step: install.step, message }, 'server install failed')
}
