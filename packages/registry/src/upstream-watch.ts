// The upstream-drift check behind the claude-official curation promise:
// has the pinned upstream repo (anthropics/skills) moved past our snapshot
// in any folder we republish? Deliberately a REPORT, not an auto-republish —
// the human review between "upstream changed" and "our hub ships it" IS the
// curation. One home for the logic; two callers: the operator CLI
// (`pnpm cloud:check-anthropic`) and the hub's daily in-process job
// (cloud-api `upstream-watch-job`, Chad's "cron on the cloud server" call,
// 2026-08-02).
//
// Clones blob-less + no-checkout (history and trees only — no file payloads)
// into a temp dir, then name-level-diffs each republished folder pin..HEAD.
// `upstream.repo` may be a URL or a local path (tests use fixture repos).

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit } from './git-fetch.js'

export type UpstreamWatchManifest = {
  upstream: { repo: string; pinnedSha: string }
  items: Array<{ itemId: string; version: string }>
}

export type UpstreamWatchItemVerdict = {
  itemId: string
  version: string
  changed: boolean
  changedFiles: string[]
}

export type UpstreamWatchReport = {
  checkedAt: string
  repo: string
  pinnedSha: string
  upstreamHeadSha: string
  /** HEAD === pin — nothing anywhere has moved. */
  upToDate: boolean
  /** How many REPUBLISHED folders moved (HEAD can move without touching any). */
  movedCount: number
  items: UpstreamWatchItemVerdict[]
  /** The operator's next step when something moved; null while clean. */
  repinRecipe: string | null
}

// All git runs ride the shared hardened home (git-fetch.ts) — one place
// carries the ext::-transport block and the timeout.
function git(cwd: string, args: string[]): Promise<string> {
  return runGit(['-C', cwd, ...args])
}

export async function checkUpstreamAgainstPin(
  manifest: UpstreamWatchManifest,
): Promise<UpstreamWatchReport> {
  // Defense-in-depth: the manifest is our checked-in file, but its values
  // reach git argv — the `--` keeps a `-`-prefixed repo string from being
  // parsed as an option, and the pin must be a full commit sha before it is
  // interpolated into the diff range.
  if (!/^[0-9a-f]{40}$/.test(manifest.upstream.pinnedSha)) {
    throw new Error(
      `upstream-watch: pinnedSha '${manifest.upstream.pinnedSha}' is not a full commit sha`,
    )
  }
  const cloneDir = await mkdtemp(join(tmpdir(), 'vynel-upstream-watch-'))
  try {
    await runGit([
      'clone',
      '--filter=blob:none',
      '--no-checkout',
      '--',
      manifest.upstream.repo,
      cloneDir,
    ])
    const upstreamHeadSha = await git(cloneDir, ['rev-parse', 'HEAD'])
    const checkedAt = new Date().toISOString()

    if (upstreamHeadSha === manifest.upstream.pinnedSha) {
      return {
        checkedAt,
        repo: manifest.upstream.repo,
        pinnedSha: manifest.upstream.pinnedSha,
        upstreamHeadSha,
        upToDate: true,
        movedCount: 0,
        items: manifest.items.map((item) => ({ ...item, changed: false, changedFiles: [] })),
        repinRecipe: null,
      }
    }

    const items: UpstreamWatchItemVerdict[] = []
    for (const item of manifest.items) {
      const changed = await git(cloneDir, [
        'diff',
        '--name-only',
        `${manifest.upstream.pinnedSha}..${upstreamHeadSha}`,
        '--',
        `skills/${item.itemId}/`,
      ])
      items.push({
        itemId: item.itemId,
        version: item.version,
        changed: changed !== '',
        changedFiles: changed === '' ? [] : changed.split('\n'),
      })
    }
    const movedCount = items.filter((item) => item.changed).length

    return {
      checkedAt,
      repo: manifest.upstream.repo,
      pinnedSha: manifest.upstream.pinnedSha,
      upstreamHeadSha,
      upToDate: false,
      movedCount,
      items,
      repinRecipe:
        movedCount === 0
          ? null
          : 'review each changed folder diff, re-audit its LICENSE, then update ' +
            `scripts/anthropic-catalog/manifest.json (pinnedSha → ${upstreamHeadSha}, bump changed ` +
            "items' versions) and re-run: pnpm cloud:import-anthropic -- --source <checkout at the new pin>",
    }
  } finally {
    await rm(cloneDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
