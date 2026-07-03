// `createDesktopNotificationListener` — the process-wide notification engine.
//
// Spawns the vendored PowerShell helper (Windows `UserNotificationListener` →
// NDJSON), parses + REDACTS each line at ingest, and holds the result in a
// bounded in-memory ring buffer. Exposes the `DesktopNotificationReader`
// surface (`listSince`) the MCP tool reads from.
//
// ONE instance lives for the whole process (created at api boot, stopped on
// shutdown) — never one per chat session (that would leak a PowerShell child
// per session). Resilient by design: a missing PowerShell / denied notification
// grant logs and leaves the listener idle (`listSince` returns []) — it never
// crashes boot.

import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { StructuralLogger } from '@vynel/logger'
import type { DesktopNotification, DesktopNotificationReader } from './desktop-notification.js'
import { RingBuffer } from './ring-buffer.js'
import { parseNotificationLine } from './parse-notification-line.js'
import { takeCompleteLines } from './ndjson-line-splitter.js'
import { resolveDesktopOs } from '../platform.js'

const helperDir = dirname(fileURLToPath(import.meta.url))
const POWERSHELL_HELPER_PATH = join(helperDir, 'notification-listener.ps1')
const DEFAULT_CAPACITY = 200

export type DesktopNotificationListener = DesktopNotificationReader & {
  /** Start the OS backend. Idempotent; a no-op (logged) on unsupported platforms. */
  start(): Promise<void>
  /** Stop the OS backend and release the helper process. Idempotent. */
  stop(): void
}

export type CreateDesktopNotificationListenerOptions = {
  logger: StructuralLogger
  /** Ring-buffer capacity (newest N retained). Default 200. */
  capacity?: number
}

export function createDesktopNotificationListener(
  options: CreateDesktopNotificationListenerOptions,
): DesktopNotificationListener {
  const { logger } = options
  const capacity = options.capacity ?? DEFAULT_CAPACITY
  const buffer = new RingBuffer<DesktopNotification>(capacity, (notification) => notification.timestamp)
  let child: ChildProcess | undefined
  let stdoutTail = ''

  const ingest = (line: string): void => {
    const notification = parseNotificationLine(line)
    if (notification !== null) {
      buffer.push(notification)
    }
  }

  return {
    async start(): Promise<void> {
      const os = resolveDesktopOs()
      if (os !== 'windows') {
        logger.info({ os }, 'desktop-notifications: no backend for this OS; listener idle')
        return
      }
      if (child !== undefined) {
        return
      }
      try {
        // Windows PowerShell 5.1 ("powershell") ships with the OS and has WinRT
        // type access without downloading assemblies. Args (not a shell string)
        // so the helper is the direct child — `stop()`'s kill terminates it.
        // stdin 'ignore' → stdout/stderr 'pipe'; node types stdout/stderr as
        // `Readable | null` on ChildProcess, so guard with `?.` (they are live
        // at runtime since we asked for pipes).
        //
        // `-ParentPid` = this process's pid. The helper polls it and self-exits
        // when we're gone, so an ABRUPT api death (SIGKILL / crash, where the
        // graceful `stop()` below never runs) can't orphan the poller. The
        // graceful path still kills it directly via `stop()`.
        const spawned = spawn(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            POWERSHELL_HELPER_PATH,
            '-ParentPid',
            String(process.pid),
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        child = spawned

        spawned.stdout?.setEncoding('utf8')
        spawned.stdout?.on('data', (chunk: string) => {
          const { lines, rest } = takeCompleteLines(stdoutTail + chunk)
          stdoutTail = rest
          for (const line of lines) {
            ingest(line)
          }
        })

        spawned.stderr?.setEncoding('utf8')
        spawned.stderr?.on('data', (chunk: string) => {
          // Most common: the user hasn't granted notification access (the helper
          // exits non-zero after writing the reason here).
          logger.warn({ detail: chunk.trim() }, 'desktop-notifications: helper stderr')
        })

        spawned.on('error', (err) => {
          logger.error({ err }, 'desktop-notifications: failed to spawn PowerShell helper')
          child = undefined
        })

        spawned.on('exit', (code) => {
          logger.info({ code }, 'desktop-notifications: helper exited')
          child = undefined
        })

        logger.info(
          { capacity, helper: POWERSHELL_HELPER_PATH },
          'desktop-notifications: listener started',
        )
      } catch (err) {
        // Degrade gracefully — a notification backend failure must not crash boot.
        logger.error({ err }, 'desktop-notifications: listener failed to start; continuing idle')
        child = undefined
      }
    },

    stop(): void {
      if (child !== undefined) {
        child.kill()
        child = undefined
      }
    },

    listSince(sinceIso?: string): DesktopNotification[] {
      return buffer.listSince(sinceIso)
    },
  }
}
