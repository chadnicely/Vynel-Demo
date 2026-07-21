// The ONE app-name matching rule every desktop surface shares — UIA
// enumeration (`App.find`), the pid fallback (`windowed-process.ts`), and the
// screenshot window match all target apps the same way, so the model's "read
// Discord" resolves identically on every path.

/**
 * Whether an app's name matches the caller's query (case-insensitive substring).
 * Window titles are dynamic ("*Notes.txt - Notepad"), so exact match is wrong —
 * substring lets the model target "Notepad" or "Chrome" without the full title.
 */
export function isAppNameMatch(appName: string, query: string): boolean {
  return appName.toLowerCase().includes(query.trim().toLowerCase())
}
