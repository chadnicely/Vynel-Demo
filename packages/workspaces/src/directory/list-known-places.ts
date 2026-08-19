// The "quick access" places the filesystem browser pins in its sidebar — the
// user's home plus the standard user folders (Desktop, Documents, …), the way
// Windows Explorer's left rail does. Only places that actually exist are
// returned, so a machine without a Music folder simply doesn't list one.
//
// Windows may redirect Desktop/Documents/Pictures into OneDrive; when the
// plain home folder is missing we fall back to the OneDrive twin so the place
// still resolves to where the user's files really live. Every path returned is
// realpath-canonical, exactly like the listing's own `path`, so a picker can
// compare the two by string and the rail lights the right row.

import { realpath, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import path from 'node:path'

export type KnownPlaceKind =
  | 'home'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'pictures'
  | 'music'
  | 'videos'

export type KnownPlace = {
  kind: KnownPlaceKind
  /** Display name — the folder's real name, so a localized OS reads right. */
  name: string
  /** Absolute path. */
  path: string
}

const USER_FOLDER_NAMES: Array<{ kind: Exclude<KnownPlaceKind, 'home'>; names: string[] }> = [
  { kind: 'desktop', names: ['Desktop'] },
  { kind: 'documents', names: ['Documents'] },
  { kind: 'downloads', names: ['Downloads'] },
  { kind: 'pictures', names: ['Pictures'] },
  { kind: 'music', names: ['Music'] },
  // macOS calls it Movies.
  { kind: 'videos', names: ['Videos', 'Movies'] },
]

export async function listKnownPlaces(): Promise<KnownPlace[]> {
  const home = await canonicalOrRaw(homedir())
  const roots = platform() === 'win32' ? [home, path.join(home, 'OneDrive')] : [home]
  const userFolders = await Promise.all(
    USER_FOLDER_NAMES.map(async ({ kind, names }): Promise<KnownPlace | null> => {
      const found = await firstExistingDirectory(
        roots.flatMap((root) => names.map((name) => path.join(root, name))),
      )
      return found === null ? null : { kind, name: path.basename(found), path: found }
    }),
  )
  return [
    { kind: 'home', name: path.basename(home) || home, path: home },
    ...userFolders.filter((place): place is KnownPlace => place !== null),
  ]
}

async function firstExistingDirectory(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return await realpath(candidate)
    } catch {
      // Not there — try the next candidate.
    }
  }
  return null
}

// The home directory always exists; realpath only fails on an exotic mount,
// and then the raw path is still the truthful answer.
async function canonicalOrRaw(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch {
    return target
  }
}
