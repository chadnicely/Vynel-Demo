// What Windows Explorer hides by default, by NAME. Node can't read the Hidden
// or System attribute (fs.stat exposes no Windows attributes and a per-listing
// spawn is too slow for a folder picker), so the browser mirrors Explorer's
// default view for the folders and files Windows itself creates: nobody makes
// a workspace in `$Recycle.Bin`, and `pagefile.sys` is noise in a file pick.
// The legacy profile junctions ("Application Data", "Documents and Settings")
// need no entry — readdir reports them as links, not directories. A user's own
// hidden folder still shows; that's the deliberate limit of a name-based rule.

const HIDDEN_DIRECTORY_NAMES = new Set(
  [
    'System Volume Information',
    'Recovery',
    'Config.Msi',
    'MSOCache',
    'Boot',
    'ProgramData',
    'AppData',
    'OneDriveTemp',
    'IntelGraphicsProfiles',
  ].map((name) => name.toLowerCase()),
)

const HIDDEN_FILE_NAMES = new Set(
  [
    'pagefile.sys',
    'hiberfil.sys',
    'swapfile.sys',
    'bootmgr',
    'BOOTNXT',
    'DumpStack.log.tmp',
    'desktop.ini',
    'Thumbs.db',
    'ntuser.ini',
  ].map((name) => name.toLowerCase()),
)

/** Dot-hidden (every OS) or one of Windows' own system folders (`$Recycle.Bin`, …). */
export function isExplorerHiddenDirectory(name: string): boolean {
  return name.startsWith('.') || name.startsWith('$') || HIDDEN_DIRECTORY_NAMES.has(name.toLowerCase())
}

/** Dot-hidden, or one of Windows' own system files (`pagefile.sys`, `NTUSER.DAT`, …). */
export function isExplorerHiddenFile(name: string): boolean {
  const lower = name.toLowerCase()
  return name.startsWith('.') || lower.startsWith('ntuser.dat') || HIDDEN_FILE_NAMES.has(lower)
}
