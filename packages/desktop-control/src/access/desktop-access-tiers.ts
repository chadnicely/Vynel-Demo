// The per-app access-tier model — Vynel's port of the tiered grant scheme
// Claude's own desktop control ships (read / click / full, escalating). A
// grant names ONE app at ONE tier; every desktop operation resolves its
// target app first and then asks "does the user's grant for THAT app cover
// THIS capability?". Pure module: no db, no natives — the enforcement that
// consults the db lives in `assert-desktop-access.ts`.

export const DESKTOP_ACCESS_TIERS = ['read', 'click', 'full'] as const
export type DesktopAccessTier = (typeof DESKTOP_ACCESS_TIERS)[number]

// Escalating, strictly ordered: `full` covers `click` covers `read`.
const TIER_RANK: Record<DesktopAccessTier, number> = { read: 0, click: 1, full: 2 }

export function isDesktopAccessTier(value: unknown): value is DesktopAccessTier {
  return typeof value === 'string' && (DESKTOP_ACCESS_TIERS as readonly string[]).includes(value)
}

/** Whether a granted tier covers a required capability tier. */
export function tierAllows(granted: DesktopAccessTier, required: DesktopAccessTier): boolean {
  return TIER_RANK[granted] >= TIER_RANK[required]
}

/** The higher of two tiers — upserts never silently DOWNGRADE a grant. */
export function maxTier(a: DesktopAccessTier, b: DesktopAccessTier): DesktopAccessTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

/**
 * The grant key for an app name: trimmed, casefolded, `.exe` stripped — so
 * "Discord", "discord" and "Discord.exe" (xa11y vs node-screenshots naming)
 * resolve to ONE grant row. Exact-match by design: fuzzy grant matching would
 * be a security hole (a grant for "Word" must never cover "PasswordSafe").
 */
export function normalizeDesktopAppKey(appName: string): string {
  return appName.trim().toLowerCase().replace(/\.exe$/, '')
}

/**
 * The enforcement hook the execution adapters call AFTER resolving their
 * target app and BEFORE touching it. Throws (ForbiddenError) to deny. Keeping
 * it a callback keeps the a11y/input layers db-free — only the MCP server
 * builder knows how to construct one against the session's db + user.
 */
export type DesktopAccessAuthorizer = (
  resolvedAppName: string,
  required: DesktopAccessTier,
) => void
