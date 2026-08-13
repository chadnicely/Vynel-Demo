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

// Both the friendly form (measured) and the executable-name form: the window
// source can report a raw exe PATH as an app name (measured on the packaged
// Notepad), and a host arriving that way would reduce to "ApplicationFrameHost"
// — which must not dodge the rule this file exists for.
const WINDOW_HOST_PROCESS_NAMES = new Set(['application frame host', 'applicationframehost'])

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
/**
 * What to tell the model when a hosted pid owns several windows and so cannot
 * be resolved to one app.
 *
 * ONE home because both window-arranging tools say it and they must not drift —
 * and because the obvious wording is a lie. The first draft ended "name the app
 * exactly as list_open_apps reports it", which cannot work twice over: identity
 * ignores the query entirely, and `list_open_apps` reads xa11y's `App.list()`,
 * which shows only ONE packaged app at a time — the app the model would need to
 * name is precisely the one that source cannot show. That would have sent it
 * round a rename loop that can never succeed. Same rule as `trayHiddenMessage`:
 * offer the recovery that works, and never promise one that doesn't.
 */
export function hostedAmbiguityMessage(query: string, verb: string): string {
  return (
    `Could not tell which app owns the window matching "${query}", so nothing was ${verb}. Windows ` +
    'runs every Store app (Calculator, Settings, Photos, Store) inside ONE shared process, so while ' +
    'several are open no name can pick one of them — retrying with a different name will fail the ' +
    'same way. Close the other Store apps, or ask the user to, then retry.'
  )
}

/**
 * What to tell the model when a packaged app is open but another one is holding
 * the accessibility connection.
 *
 * xa11y keys its app list by PROCESS, and every Store app shares one
 * `ApplicationFrameHost` — so with two open, only one has a readable tree and
 * the other fails deep inside the binding with
 * `No element matched selector: application[pid=6280]`. That is not a message a
 * model can act on: it names an internal selector and a pid, so the obvious
 * response is to retry or give up, when there is a route that works.
 *
 * There IS one: `screenshot_app` reads these windows perfectly (it goes through
 * node-screenshots, which sees each window separately). So this says the true
 * thing and names the working door, rather than leaving a dead end.
 */
export function shadowedStoreAppMessage(query: string, intent: string): string {
  return (
    `Cannot ${intent} "${query}" through the accessibility tree right now. It is a Windows Store ` +
    'app, and Store apps share one process — while another one is open, only that one is readable. ' +
    `This is a limitation of the accessibility engine, NOT a sign the app is missing: "${query}" is ` +
    'open and perfectly visible. Use screenshot_app instead, which reads these windows normally, ' +
    'and act with coordinates from that capture. Closing the other Store app also frees the tree.'
  )
}

/**
 * A window source can report a raw executable PATH as the app name — measured
 * live 2026-08-13: the packaged Windows 11 Notepad arrives as
 * "C:\Program Files\WindowsApps\Microsoft.WindowsNotepad_…\Notepad.exe". A path
 * is not a name a plan can sensibly carry or a log a user reads, so it reduces
 * to its display half: basename, minus the .exe suffix. Deliberately narrow —
 * bare names pass through untouched, even "chrome.exe", so nothing that already
 * worked changes key.
 */
export function displayNameFromPathishAppName(appName: string): string {
  if (!appName.includes('\\') && !appName.includes('/')) return appName
  const basename = appName.split(/[\\/]/).pop()?.trim() ?? ''
  const withoutExtension = basename.replace(/\.exe$/i, '').trim()
  return withoutExtension.length > 0 ? withoutExtension : appName
}

export function readWindowIdentity(native: {
  appName(): unknown
  title?(): unknown
}): string | null {
  try {
    const appName = displayNameFromPathishAppName(String(native.appName() ?? '').trim())
    if (!isWindowHostProcess(appName)) return appName.length > 0 ? appName : null
    const title = String(native.title?.() ?? '').trim()
    return title.length > 0 ? title : null
  } catch {
    // A shape surprise on one window must not blind the whole lookup.
    return null
  }
}
