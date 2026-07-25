// Wire shaping for monitor rows — Dates to ISO, and the internal
// `ownerSessionId` deliberately withheld. That column is server-resolved
// ambient identity (the report-caller precedent); echoing it back would put a
// session id in front of the model, which is exactly what stamping it
// server-side was meant to avoid.

import type { Monitor } from '@vynel/monitors'

export function serializeMonitorForResponse(monitor: Monitor) {
  return {
    id: monitor.id,
    workspaceId: monitor.workspaceId,
    ownerKind: monitor.ownerKind,
    description: monitor.description,
    eventTypes: monitor.eventTypes,
    payloadFilter: monitor.payloadFilter,
    mode: monitor.mode,
    status: monitor.status,
    expiresAt: monitor.expiresAt.toISOString(),
    firedCount: monitor.firedCount,
    lastFiredAt: monitor.lastFiredAt?.toISOString() ?? null,
    createdAt: monitor.createdAt.toISOString(),
  }
}
