// The mode → plan-consent policy, in ONE home (both global-root turn sites
// call it). The desktop feature stays session-vocabulary-free: it receives the
// turn's permission mode as an opaque string and maps only the values it has a
// ruling for — anything else (absent mode = the unattended
// `bypass-with-behavior-gate` default, or a future mode this policy hasn't
// ruled on) falls to 'display-only', the conservative floor: the plan still
// narrates on the overlay, but authority comes ONLY from standing per-app
// grants, preserving "a background turn can never self-grant" (Chad 2026-08-04).

import type { DesktopPlanConsent } from '@vynel/mcp-contract'

export function deriveDesktopPlanConsent(permissionMode: string | undefined): DesktopPlanConsent {
  switch (permissionMode) {
    // The plan tool rides the ask-approval tier, so in ask mode proposing a
    // plan raises the card — user approval IS the consent for its apps.
    case 'ask':
      return 'approval-card'
    // The user's own auto/bypass are the standing consent (the same ruling
    // that lets request_desktop_access grant uncarded there).
    case 'auto':
    case 'bypass':
      return 'standing-consent'
    default:
      return 'display-only'
  }
}
