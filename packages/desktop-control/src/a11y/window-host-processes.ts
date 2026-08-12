// Processes that HOST other apps' windows rather than being an app themselves —
// and therefore what a window should actually be CALLED.
//
// Windows runs every packaged (UWP/Store) app's window inside one shared
// `ApplicationFrameHost` process, so the process name identifies the host, not
// the app. Measured live 2026-08-12 with Calculator and Settings open together:
//
//   "Application Frame Host" | "Settings"   | pid 8828
//   "Application Frame Host" | "Calculator" | pid 8828
//
// Two different apps, one process name, one pid. Treating that name as an
// identity is a real widening — one consent covers Calculator, Settings, Store,
// Photos and Mail at once — and it makes any record of what happened a lie
// ("acted on Application Frame Host" when it opened Calculator). For these
// windows the TITLE is the app.
//
// Its own leaf, with no imports, because BOTH identity paths need it and they
// already point at each other: `window-identity.ts` reaches the window source
// through `screenshot-adapter.ts`, so the rule cannot live in either without
// making the pair circular.

const WINDOW_HOST_PROCESS_NAMES = new Set(['application frame host'])

/** Whether an app name names a window HOST rather than an app. */
export function isWindowHostProcess(appName: string): boolean {
  return WINDOW_HOST_PROCESS_NAMES.has(appName.trim().toLowerCase())
}

/**
 * What a single window should be CALLED — the one home for the host rule, so
 * every identity path (the roster, the pid lookup, the focus and hit-test
 * targets, the screenshot adapter) agrees. Null when the window can't be named,
 * which callers must treat as "unidentified", never as a name.
 *
 * A host-owned window with no title yields null rather than falling back to the
 * host name: an unnameable window must fail closed, because the alternative is
 * handing back a name that spans a whole class of apps.
 */
export function readWindowIdentity(native: {
  appName(): unknown
  title?(): unknown
}): string | null {
  try {
    const appName = String(native.appName() ?? '').trim()
    if (!isWindowHostProcess(appName)) return appName.length > 0 ? appName : null
    const title = String(native.title?.() ?? '').trim()
    return title.length > 0 ? title : null
  } catch {
    // A shape surprise on one window must not blind the whole lookup.
    return null
  }
}
