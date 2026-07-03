// The normalized desktop notification event + the read interface the api
// injects into request context. NOT a database row — notifications are
// ephemeral (held in an in-memory ring buffer, never persisted; persisting a
// 2FA code would itself be the leak — see README "Privacy posture").

export type DesktopNotification = {
  /** Per-notification id from the OS (Windows toast id). Empty when the backend has none. */
  id: string
  /** Source app display name, e.g. "Slack", "Mail". `unknown` when unavailable. */
  app: string
  /** Title line — one-time codes redacted at ingest. Empty string when absent. */
  title: string
  /** Body text — one-time codes redacted at ingest. Empty string when absent. */
  body: string
  /** ISO 8601 capture time (UTC). */
  timestamp: string
}

/**
 * The read surface the api exposes on `c.var.desktopNotifications` and the MCP
 * tool consumes. The listener implements it; tests pass an in-memory fake.
 */
export type DesktopNotificationReader = {
  /**
   * Notifications captured strictly after `sinceIso` (ISO 8601), oldest-first.
   * All buffered notifications when omitted. Already redacted at ingest.
   */
  listSince(sinceIso?: string): DesktopNotification[]
}
