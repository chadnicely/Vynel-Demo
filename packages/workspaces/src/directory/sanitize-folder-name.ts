// Folder-name sanitizer — replaces characters unsafe across OSes (Windows is
// strictest) + the C0 control range with `_`, trims, and falls back to
// "workspace" when nothing usable remains. The new-workspace wizard's
// scaffold derives a folder from a display name; the manual create flow
// adopts an existing directory and doesn't need this.
//
// Pattern built without a literal control-char regex so the source stays
// lint-clean.

const UNSAFE_FOLDER_NAME_PATTERN = new RegExp('[<>:"/\\\\|?*' + '\\u0000-\\u001f' + ']', 'g')

export function sanitizeFolderName(rawName: string): string {
  return rawName.replace(UNSAFE_FOLDER_NAME_PATTERN, '_').trim() || 'workspace'
}
