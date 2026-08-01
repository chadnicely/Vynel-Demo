// The operator CLI for the upstream-drift check — a thin printer over
// `@vynel/registry`'s `checkUpstreamAgainstPin` (the ONE home for the
// logic; the hub's daily in-process job is the other caller).
//
//   pnpm cloud:check-anthropic
//
// Exit code: 0 = all pinned, 1 = upstream moved (cron/CI-friendly).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkUpstreamAgainstPin, type UpstreamWatchManifest } from '@vynel/registry'

/* eslint-disable no-console -- stdout IS this CLI's output channel */

async function main(): Promise<void> {
  const manifest: UpstreamWatchManifest = JSON.parse(
    readFileSync(join('scripts', 'anthropic-catalog', 'manifest.json'), 'utf8'),
  )
  const report = await checkUpstreamAgainstPin(manifest)

  if (report.upToDate) {
    console.log(`up to date: upstream HEAD is the pinned ${report.pinnedSha.slice(0, 7)}`)
    return
  }

  for (const item of report.items) {
    if (!item.changed) {
      console.log(`  unchanged  ${item.itemId}@${item.version}`)
      continue
    }
    console.log(
      `  CHANGED    ${item.itemId}@${item.version}\n${item.changedFiles.map((f) => `             ${f}`).join('\n')}`,
    )
  }

  console.log(
    `\nupstream HEAD ${report.upstreamHeadSha.slice(0, 7)} vs pin ${report.pinnedSha.slice(0, 7)}: ` +
      `${report.movedCount} of ${report.items.length} republished folder(s) moved.`,
  )
  if (report.repinRecipe !== null) {
    console.log(`to ship the changes: ${report.repinRecipe}`)
    // eslint-disable-next-line n/no-process-exit -- CI-friendly signal
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`check-upstream: ${err instanceof Error ? err.message : String(err)}`)
  // eslint-disable-next-line n/no-process-exit -- CLI non-zero exit
  process.exit(1)
})
