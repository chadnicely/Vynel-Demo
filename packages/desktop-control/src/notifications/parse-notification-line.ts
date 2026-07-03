import type { DesktopNotification } from './desktop-notification.js'
import { redactOneTimeCodes } from './redact-one-time-codes.js'

// Parse one NDJSON line from the Windows notification helper into a normalized,
// REDACTED DesktopNotification. Returns null for blank/malformed lines (the
// helper can interleave diagnostics) so the listener skips them. Redaction is
// applied HERE — at ingest — so a raw one-time code never enters the buffer.
export function parseNotificationLine(line: string): DesktopNotification | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const fields = parsed as Record<string, unknown>

  const app =
    typeof fields['app'] === 'string' && fields['app'].length > 0 ? fields['app'] : 'unknown'
  const id = typeof fields['id'] === 'string' ? fields['id'] : ''
  const rawTitle = typeof fields['title'] === 'string' ? fields['title'] : ''
  const rawBody = typeof fields['body'] === 'string' ? fields['body'] : ''
  const timestamp =
    typeof fields['timestamp'] === 'string' && fields['timestamp'].length > 0
      ? fields['timestamp']
      : new Date().toISOString()

  return {
    id,
    app,
    title: redactOneTimeCodes(rawTitle),
    body: redactOneTimeCodes(rawBody),
    timestamp,
  }
}
