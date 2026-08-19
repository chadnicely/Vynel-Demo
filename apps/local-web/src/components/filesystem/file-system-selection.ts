// What a picker dialog asks the filesystem browser for, and what it gets back.
// `folder` = the workspace picker (files hidden, like Explorer's folder
// dialog); `file` = the memory import (folders only navigate); `any` = the
// knowledge source (either). In the folder-capable modes the OPEN folder is
// the selection whenever no tile is highlighted — you step into what you want.

export type FileSystemSelectionMode = "folder" | "file" | "any";

export type FileSystemSelection = {
  kind: "folder" | "file";
  /** Absolute path. */
  path: string;
  /** The last path segment — what a dialog auto-fills a name from. */
  name: string;
};

export function isSameSelection(
  a: FileSystemSelection | null,
  b: FileSystemSelection | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.path === b.path;
}
