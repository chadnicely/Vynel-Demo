// In-app FILE links (Kafi, 2026-08-26: "paths need to be clickable"). A path
// the assistant read, wrote, or mentioned renders as an ordinary anchor on the
// app's own scheme — `vynel://file/<encoded path>` — and the shell's link
// router (apps/local-web `use-app-link-router`) opens it in the owning
// workspace's editor. ONE grammar for every surface: the tool card's path
// header, its chip, and paths spotted in chat markdown all compose the same
// href, and the router parses it back with `filePathFromAppLink`.
//
// This package stays data-blind: it never knows which workspace owns a path;
// it only says "this is a file" the way it says "this is a plan".

export const FILE_LINK_PREFIX = "vynel://file/";

export function fileLinkHref(path: string): string {
  return `${FILE_LINK_PREFIX}${encodeURIComponent(path)}`;
}

/** The path a file link carries, or null for any other href. Scheme
 *  matching is case-insensitive (DOMPurify admits `VYNEL://` too); the path
 *  keeps its case. */
export function filePathFromAppLink(href: string): string | null {
  if (!href.toLowerCase().startsWith(FILE_LINK_PREFIX)) return null;
  try {
    const path = decodeURIComponent(href.slice(FILE_LINK_PREFIX.length));
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

// What reads as a file path in prose. Deliberately narrow — a false link on
// "and/or" is worse than a missed one:
//   - an ABSOLUTE path — a drive (`C:\Users\me\notes.md`, `C:/x/y.ts`) or a
//     root (`/home/me/app.ts`) — with either separator, any depth;
//   - a RELATIVE path with at least one directory, forward slashes ONLY
//     (`src/pricing.ts`, `docs/plan.md`) — the router resolves it against the
//     room's folder. Backslashes never make a relative hit: a spaced Windows
//     path ("C:\Program Files\App\config.json") would otherwise yield the
//     wrong tail (`Files\App\config.json`) as a room-relative link.
// Every path ends in a file name with a letter-first extension ("1.2/3.4" is
// a version range, not a file), sits at a word boundary on both sides (so a
// URL's path, a `@scope/package` specifier, and a sentence-ending "." are
// never part of it), and may carry a `:line` / `:line:col` suffix. Letters
// are Unicode letters (`docs/plán/notes.md` is one path, not `n/notes.md`).
const WORD = String.raw`\p{L}\p{N}_`;
const SEGMENT = String.raw`[${WORD}.-]+`;
const FILE_NAME = String.raw`[${WORD}.-]+\.[A-Za-z][A-Za-z0-9]{0,7}`;
const LINE_SUFFIX = String.raw`(?::\d+(?::\d+)?)?`;
const FILE_PATH_PATTERN = new RegExp(
  String.raw`(?<![${WORD}./\\:@-])` +
    String.raw`((?:(?:[A-Za-z]:[\\/]|/)(?:${SEGMENT}[\\/])*|(?:${SEGMENT}/)+)${FILE_NAME}${LINE_SUFFIX})` +
    String.raw`(?![${WORD}/\\-])(?!\.[${WORD}])`,
  "gu",
);

const ABSOLUTE_START_PATTERN = /^(?:[A-Za-z]:[\\/]|~[\\/]|\/)/;

/** Every file path in a plain-text run, with its position — the raw
 *  material for a surface that wants to wrap them (MarkdownText's linkify
 *  pass). Paths inside a URL never match: the `://` guard keeps
 *  `https://x.com/a/b.md` whole. */
export function findFilePaths(text: string): Array<{ path: string; start: number; end: number }> {
  const found: Array<{ path: string; start: number; end: number }> = [];
  for (const match of text.matchAll(FILE_PATH_PATTERN)) {
    const path = match[1]!;
    const start = match.index!;
    // A URL's path part sits right after `://host` — it is not a file.
    const before = text.slice(0, start);
    if (/:\/\/[^\s]*$/.test(before)) continue;
    found.push({ path, start, end: start + path.length });
  }
  return found;
}

/** True for a path that names a place on disk on its own (drive, root, or
 *  home) — the router needs no room to resolve it. A home path (`~/x`) is
 *  absolute yet never resolvable by the router (it knows no home folder), so
 *  the prose grammar above never produces one. */
export function isAbsoluteFilePath(path: string): boolean {
  return ABSOLUTE_START_PATTERN.test(path);
}
