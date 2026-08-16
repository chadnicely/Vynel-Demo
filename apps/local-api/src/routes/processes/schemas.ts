// Zod schemas + the response serializer for the processes routes. API-internal
// (single consumer) lives beside the route, per the routing-routes precedent.

import { z } from 'zod'
import type { BackgroundProcess } from '@vynel/processes'
import {
  PROCESS_COMMAND_MAX_LENGTH,
  PROCESS_MAX_TIMEOUT_MS,
} from '@vynel/processes'

export const ProcessStatusSchema = z.enum(['running', 'succeeded', 'failed'])

export const RunProcessRequestSchema = z.object({
  /** The shell command, run at the calling scope's ground. */
  command: z.string().min(1).max(PROCESS_COMMAND_MAX_LENGTH),
  /** Runtime ceiling in ms; the process is killed past it. Default 30 minutes. */
  timeoutMs: z.number().int().min(1000).max(PROCESS_MAX_TIMEOUT_MS).optional(),
  /** The CALLING workspace — ambiently stamped by the workspace surface; the
   *  command runs at that workspace's folder. Absent = the global scope. */
  workspaceId: z.string().min(1).optional(),
})

export const ProcessParamSchema = z.object({ processId: z.string().min(1) })

export const ListProcessesQuerySchema = z.object({
  status: ProcessStatusSchema.optional(),
  /** The scope to list — ambiently stamped by the workspace surface; absent =
   *  the global scope's processes. */
  workspaceId: z.string().min(1).optional(),
})

export const ProcessResponseSchema = z.object({
  processId: z.string(),
  status: ProcessStatusSchema,
  command: z.string(),
  cwdPath: z.string(),
  workspaceId: z.string().nullable(),
  pid: z.number().nullable(),
  exitCode: z.number().nullable(),
  /** Why it failed short of a clean exit — null means it exited on its own. */
  failureReason: z.string().nullable(),
  /** The output tail — live for a running process, persisted once settled. */
  outputTail: z.string().nullable(),
  timeoutMs: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})

export const RunProcessResponseSchema = ProcessResponseSchema.extend({
  /** The auto-armed completion watch — null when arming failed (the process
   *  still runs; poll get_background_process instead). */
  monitorId: z.string().nullable(),
})

export const ListProcessesResponseSchema = z.array(ProcessResponseSchema)

/** One serialization for every door. `liveTail` overrides the row's persisted
 *  tail while the process is still running (the runner's ring buffer is the
 *  only truth then). */
export function serializeProcessForResponse(
  row: BackgroundProcess,
  liveTail?: string,
): z.infer<typeof ProcessResponseSchema> {
  return {
    processId: row.id,
    status: row.status,
    command: row.command,
    cwdPath: row.cwdPath,
    workspaceId: row.workspaceId,
    pid: row.pid,
    exitCode: row.exitCode,
    failureReason: row.failureReason,
    outputTail: row.status === 'running' ? (liveTail ?? null) : row.outputTail,
    timeoutMs: row.timeoutMs,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}
