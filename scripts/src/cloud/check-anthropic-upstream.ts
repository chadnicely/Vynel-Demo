// The claude-official arc's UPSTREAM WATCH: has anthropics/skills moved past
// our pinned snapshot in any folder we republish? Deliberately a REPORT, not
// an auto-republish — the human review between "upstream changed" and "our
// hub ships it" is the curation promise (module notes, Phase A §5).
//
//   pnpm cloud:check-anthropic
//
// Clones blob-less (fast, ~no payload) into a temp dir, diffs each
// allowlisted folder pin..HEAD, and prints per-skill verdicts + the re-pin
// recipe when something moved. Exit code: 0 = all pinned, 1 = upstream moved
// (cron/CI-friendly). An operator/dev tool.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type AnthropicCatalogManifest = {
  upstream: { repo: string; pinnedSha: string }
  items: Array<{ itemId: string; version: string }>
}

function fail(message: string): never {
  // eslint-disable-next-line no-console -- CLI error channel
  console.error(`check-upstream: ${message}`)
  // eslint-disable-next-line n/no-process-exit -- CLI non-zero exit
  process.exit(1)
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

async function main(): Promise<void> {
  const manifest: AnthropicCatalogManifest = JSON.parse(
    readFileSync(join('scripts', 'anthropic-catalog', 'manifest.json'), 'utf8'),
  )

  const cloneDir = await mkdtemp(join(tmpdir(), 'vynel-anthropic-upstream-'))
  try {
    // Blob-less + no-checkout: history and trees only — enough for
    // name-level diffs without downloading a single file payload.
    execFileSync(
      'git',
      ['clone', '--filter=blob:none', '--no-checkout', manifest.upstream.repo, cloneDir],
      { stdio: 'pipe' },
    )
    const upstreamHead = git(cloneDir, ['rev-parse', 'HEAD'])

    if (upstreamHead === manifest.upstream.pinnedSha) {
      // eslint-disable-next-line no-console -- CLI report output
      console.log(`up to date: upstream HEAD is the pinned ${manifest.upstream.pinnedSha.slice(0, 7)}`)
      return
    }

    let movedCount = 0
    for (const item of manifest.items) {
      const changed = git(cloneDir, [
        'diff',
        '--name-only',
        `${manifest.upstream.pinnedSha}..${upstreamHead}`,
        '--',
        `skills/${item.itemId}/`,
      ])
      if (changed === '') {
        // eslint-disable-next-line no-console -- CLI report output
        console.log(`  unchanged  ${item.itemId}@${item.version}`)
        continue
      }
      movedCount += 1
      // eslint-disable-next-line no-console -- CLI report output
      console.log(`  CHANGED    ${item.itemId}@${item.version}\n${changed.split('\n').map((f) => `             ${f}`).join('\n')}`)
    }

    // eslint-disable-next-line no-console -- CLI report output
    console.log(
      `\nupstream HEAD ${upstreamHead.slice(0, 7)} vs pin ${manifest.upstream.pinnedSha.slice(0, 7)}: ` +
        `${movedCount} of ${manifest.items.length} republished folder(s) moved.`,
    )
    if (movedCount > 0) {
      // eslint-disable-next-line no-console -- CLI report output
      console.log(
        'to ship the changes: review each folder diff, re-audit its LICENSE, then update\n' +
          `scripts/anthropic-catalog/manifest.json (pinnedSha → ${upstreamHead}, bump changed items' versions)\n` +
          'and re-run: pnpm cloud:import-anthropic -- --source <checkout at the new pin>',
      )
      // eslint-disable-next-line n/no-process-exit -- CI-friendly signal
      process.exit(1)
    }
  } finally {
    await rm(cloneDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err))
})
