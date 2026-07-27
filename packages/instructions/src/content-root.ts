// The repo-shipped instruction content (session-instructions/, tool-descriptions/,
// notebooks/) lives at the PACKAGE root and is found relative to this file. That
// breaks in the packaged desktop build, where every @vynel package compiles into
// one bundle far from packages/instructions — so boot points this package at the
// shipped copy instead (VYNEL_ASSETS_DIR, validated in the app's env.ts). Dev
// never calls the setter and keeps the package-relative default.

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// src/ (or dist/ once compiled) → packages/instructions/
const PACKAGE_ROOT = resolve(here, '..')

export type InstructionsContentSubdirectory =
  | 'session-instructions'
  | 'tool-descriptions'
  | 'notebooks'

let contentRootOverride: string | undefined

/**
 * Point every instruction loader at a shipped content root (bundled mode).
 * Must be called once at boot, before any load — the loaders cache what they
 * read for the process lifetime. Pass `undefined` to restore the package
 * default (tests).
 */
export function setInstructionsContentRoot(directory: string | undefined): void {
  contentRootOverride = directory
}

export function resolveInstructionsContentDirectory(
  subdirectory: InstructionsContentSubdirectory,
): string {
  return join(contentRootOverride ?? PACKAGE_ROOT, subdirectory)
}
