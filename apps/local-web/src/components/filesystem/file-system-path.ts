// Pure path presentation for the filesystem browser. The browser runs in a
// webview with no `node:path`, and it must read BOTH Windows (`E:\KLONE\x`)
// and POSIX (`/home/x`) paths exactly as the local API hands them back, so
// the splitting lives here as plain string work.

import type { DriveKind, DriveRootResponse } from "@vynel/contracts/workspaces/workspace-http";

export type PathCrumb = {
  name: string;
  /** The absolute path this crumb navigates to. */
  path: string;
};

const WINDOWS_ROOT = /^[A-Za-z]:[\\/]?/;

/** `E:\` for `E:\KLONE\x`, `/` for `/home/x`, `""` for a relative path. */
export function rootOfPath(path: string): string {
  const windowsRoot = path.match(WINDOWS_ROOT);
  if (windowsRoot) return `${windowsRoot[0].slice(0, 2)}\\`;
  return path.startsWith("/") ? "/" : "";
}

export function isDriveRootPath(path: string): boolean {
  const root = rootOfPath(path);
  return root !== "" && trimTrailingSeparators(path).length <= trimTrailingSeparators(root).length;
}

/** The last segment — `x` for `E:\KLONE\x`; the root itself for a drive root. */
export function basenameOfPath(path: string): string {
  const trimmed = trimTrailingSeparators(path);
  const lastSeparator = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return lastSeparator === -1 ? trimmed : trimmed.slice(lastSeparator + 1) || trimmed;
}

/** Explorer's address bar: one crumb per folder from the drive root down,
 *  each carrying the absolute path it navigates to. The root crumb is
 *  included (its `name` is the raw root; the UI dresses it as the drive). */
export function splitPathIntoCrumbs(path: string): PathCrumb[] {
  const root = rootOfPath(path);
  if (root === "") return [{ name: path, path }];
  const rest = path.slice(root === "/" ? 1 : root.length);
  const separator = root === "/" ? "/" : "\\";
  const crumbs: PathCrumb[] = [{ name: root, path: root }];
  let walked = root;
  for (const segment of rest.split(/[\\/]/).filter((part) => part.length > 0)) {
    walked = walked.endsWith(separator) ? `${walked}${segment}` : `${walked}${separator}${segment}`;
    crumbs.push({ name: segment, path: walked });
  }
  return crumbs;
}

/** True when `path` is `root` or lives underneath it (case-insensitive on Windows-style roots). */
export function isPathWithin(path: string, root: string): boolean {
  const normalizedRoot = trimTrailingSeparators(root);
  const caseFold = (value: string) => (WINDOWS_ROOT.test(value) ? value.toLowerCase() : value);
  const candidate = caseFold(trimTrailingSeparators(path));
  const parent = caseFold(normalizedRoot);
  return candidate === parent || candidate.startsWith(`${parent}\\`) || candidate.startsWith(`${parent}/`);
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

// ── Drives, the way Explorer names and measures them ───────────────────────

const DEFAULT_LABEL_BY_KIND: Record<DriveKind, string> = {
  fixed: "Local Disk",
  removable: "USB Drive",
  network: "Network Drive",
  optical: "CD Drive",
  unknown: "Local Disk",
};

/** `WORKSPACE (E:)` / `Local Disk (C:)` on Windows; the label or the raw root elsewhere. */
export function driveDisplayName(drive: Pick<DriveRootResponse, "path" | "label" | "kind">): string {
  const label = drive.label ?? DEFAULT_LABEL_BY_KIND[drive.kind];
  const windowsRoot = drive.path.match(WINDOWS_ROOT);
  return windowsRoot ? `${label} (${windowsRoot[0].slice(0, 2)})` : (drive.label ?? drive.path);
}

/** Explorer's three-significant-figure binary sizes: `51.2 GB`, `7.64 GB`, `399 GB`.
 *  Truncated, not rounded, exactly like Explorer — 29.99 GB reads "29.9 GB". */
export function formatBytesLikeExplorer(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const scale = 10 ** decimals;
  const truncated = Math.floor(value * scale) / scale;
  return `${truncated.toFixed(decimals)} ${units[unitIndex]}`;
}
