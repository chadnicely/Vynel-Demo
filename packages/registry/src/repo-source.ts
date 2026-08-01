// The shared "a GitHub repo folder at a pinned commit" plumbing behind the
// publish-from-repo and inspect-repo operations: the URL wall (https +
// github.com only, no embedded credentials), subpath validation, ref→sha
// resolve-then-pin, and the clone-into-tempdir lifecycle. The git calls ride
// an injectable seam (`RepoGitDeps`) so tests drive the REAL git code
// against local fixture repos while the URL wall stays absolute.

import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { GIT_FULL_SHA, cloneRepoAtPin, resolveRepoRefToSha } from './git-fetch.js'

export const RepoSourceSchema = z.object({
  url: z.string().min(1).max(400),
  /** Branch, tag, full sha, or HEAD (the default). */
  ref: z.string().min(1).max(200).optional(),
  /** Folder inside the repo to publish; empty/omitted = the repo root. */
  subpath: z.string().max(400).optional(),
})

export type RepoSourceInput = z.infer<typeof RepoSourceSchema>

export interface RepoGitDeps {
  readonly resolveRefToSha: typeof resolveRepoRefToSha
  readonly cloneAtPin: typeof cloneRepoAtPin
}

export const realRepoGitDeps: RepoGitDeps = {
  resolveRefToSha: resolveRepoRefToSha,
  cloneAtPin: cloneRepoAtPin,
}

/** The host allowlist: exactly https://github.com/<owner>/<repo>. Embedded
 *  credentials are refused outright (they'd reach git argv and logs). */
export function assertGithubRepoUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new ValidationError(`'${rawUrl}' is not a valid URL.`)
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Repo imports accept https:// URLs only.')
  }
  if (parsed.hostname !== 'github.com') {
    throw new ValidationError('Repo imports accept github.com repositories only.')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ValidationError('The repo URL must not embed credentials.')
  }
  if (parsed.port !== '') {
    throw new ValidationError('The repo URL must use the default https port.')
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new ValidationError('The repo URL must not carry a query string or fragment.')
  }
}

/** The URL as shown in credit links: no trailing `.git`, no trailing slash.
 *  Slashes strip FIRST so `…/repo.git/` still sheds its `.git`. */
export function repoDisplayUrl(rawUrl: string): string {
  return rawUrl.replace(/\/+$/, '').replace(/\.git$/, '')
}

/** `<repo>/tree/<sha>[/<subpath>]` — the pin-anchored credit-line origin. */
export function deriveRepoSourceUrl(rawUrl: string, sha: string, subpath: string): string {
  const base = `${repoDisplayUrl(rawUrl)}/tree/${sha}`
  return subpath === '' ? base : `${base}/${subpath}`
}

/** Normalize + validate the subpath: forward slashes, no empty/`.`/`..`
 *  segments, no backslashes. Returns '' for the repo root. */
export function normalizeRepoSubpath(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (trimmed === '') return ''
  if (trimmed.includes('\\')) {
    throw new ValidationError('The repo subpath must use forward slashes.')
  }
  const segments = trimmed.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ValidationError('The repo subpath must not traverse outside the repository.')
  }
  return segments.join('/')
}

export interface ClonedRepoSource {
  /** The resolved full commit sha the clone sits at. */
  readonly resolvedSha: string
  /** Absolute path of the requested folder inside the clone. */
  readonly folder: string
  /** The normalized subpath ('' = repo root). */
  readonly subpath: string
}

/**
 * Resolve the source's ref to a sha, clone at that pin into a temp dir, and
 * hand the requested folder to `work`. The temp dir is removed in `finally`
 * whatever happens. The caller must have passed `assertGithubRepoUrl` first
 * — this function trusts `source.url` into git argv (behind `--`).
 */
export async function withClonedRepoSource<T>(
  source: RepoSourceInput,
  deps: RepoGitDeps,
  work: (clone: ClonedRepoSource) => Promise<T>,
): Promise<T> {
  const subpath = normalizeRepoSubpath(source.subpath)
  const ref = source.ref ?? 'HEAD'
  const resolvedSha = await deps.resolveRefToSha(source.url, ref)
  if (resolvedSha === null) {
    throw new NotFoundError('repo ref', `${ref} in ${repoDisplayUrl(source.url)}`)
  }
  if (!GIT_FULL_SHA.test(resolvedSha)) {
    throw new ValidationError(`ref '${ref}' resolved to '${resolvedSha}', not a full commit sha.`)
  }

  const cloneDir = await mkdtemp(join(tmpdir(), 'vynel-repo-source-'))
  try {
    await deps.cloneAtPin(source.url, resolvedSha, cloneDir)
    const folder = subpath === '' ? cloneDir : join(cloneDir, ...subpath.split('/'))
    // Belt over the segment validation above: the resolved folder must still
    // sit inside the clone.
    if (folder !== cloneDir && !resolve(folder).startsWith(resolve(cloneDir) + sep)) {
      throw new ValidationError('The repo subpath must not traverse outside the repository.')
    }
    const folderStat = await stat(folder).catch(() => null)
    if (folderStat === null || !folderStat.isDirectory()) {
      throw new NotFoundError('repo folder', subpath === '' ? '(repo root)' : subpath)
    }
    return await work({ resolvedSha, folder, subpath })
  } finally {
    await rm(cloneDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
