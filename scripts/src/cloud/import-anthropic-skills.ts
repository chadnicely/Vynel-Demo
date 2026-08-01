// Import the allowlisted Anthropic official skills into the hub registry —
// the claude-official arc's publish pipeline. The allowlist + pinned
// upstream SHA live in `scripts/anthropic-catalog/manifest.json`; the skill
// bytes come from a LOCAL checkout of anthropics/skills whose HEAD must
// match the pin (we publish a reviewed snapshot — upstream changes land only
// through a manifest re-pin + re-run). Each skill folder is zipped
// faithfully (SKILL.md at the zip root, licenses ride along) and published
// under the `anthropic` / `anthropic-official` publisher.
//
//   git clone https://github.com/anthropics/skills <checkout>
//   git -C <checkout> checkout <pinnedSha>
//   pnpm cloud:import-anthropic -- --source <checkout> [--only <itemId>]
//
// Env: CLOUD_ADMIN_TOKEN (required); VYNEL_HUB_URL or --url (default
// http://localhost:18890). An operator/dev tool — reads process.env directly.
// A version that is already published is SKIPPED (409 → safe re-runs after
// a partial import); bump the manifest version to ship an update.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSkillFolder, type AnthropicImportManifest } from '@vynel/registry'

function fail(message: string): never {
  // eslint-disable-next-line no-console -- CLI error channel
  console.error(`import-anthropic: ${message}`)
  // eslint-disable-next-line n/no-process-exit -- CLI non-zero exit
  process.exit(1)
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const sourceCheckout = argValue('--source')
  if (sourceCheckout === undefined) {
    fail('usage: cloud:import-anthropic -- --source <anthropics/skills checkout> [--only <itemId>]')
  }
  const hubUrl =
    (argValue('--url') ?? process.env['VYNEL_HUB_URL'])?.replace(/\/+$/, '') ??
    'http://localhost:18890'
  const adminToken = process.env['CLOUD_ADMIN_TOKEN']
  if (adminToken === undefined || adminToken === '') fail('CLOUD_ADMIN_TOKEN is not set')
  const only = argValue('--only')
  if (process.argv.includes('--only') && (only === undefined || only.startsWith('--'))) {
    fail('--only requires an itemId (e.g. --only canvas-design)')
  }

  const manifest: AnthropicImportManifest = JSON.parse(
    readFileSync(join('scripts', 'anthropic-catalog', 'manifest.json'), 'utf8'),
  )

  // The supply-chain gate: we publish exactly the reviewed snapshot, never
  // whatever upstream HEAD happens to be today.
  const checkoutSha = execFileSync('git', ['-C', sourceCheckout, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  if (checkoutSha !== manifest.upstream.pinnedSha) {
    fail(
      `checkout is at ${checkoutSha} but the manifest pins ${manifest.upstream.pinnedSha} — ` +
        `git -C ${sourceCheckout} checkout ${manifest.upstream.pinnedSha}`,
    )
  }

  const items = manifest.items.filter((item) => only === undefined || item.itemId === only)
  if (items.length === 0) fail(`no manifest item matches --only ${only}`)

  for (const item of items) {
    const folder = join(sourceCheckout, 'skills', item.itemId)
    const artifact = await zipSkillFolder(folder)
    const sourceUrl = `${manifest.upstream.repo}/tree/${manifest.upstream.pinnedSha}/skills/${item.itemId}`

    const response = await fetch(`${hubUrl}/admin/catalog/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        publisher: manifest.publisher,
        item: {
          itemId: item.itemId,
          kind: 'skill',
          displayName: item.displayName,
          oneLineDescription: item.oneLineDescription,
          category: item.category,
          iconName: item.iconName,
          recommendedScope: item.recommendedScope,
          sourceUrl,
          minimumTier: 'basic',
          status: 'published',
        },
        version: {
          version: item.version,
          changelog: `imported from anthropics/skills@${checkoutSha.slice(0, 7)}`,
          manifest: { entry: 'SKILL.md' },
        },
        artifactBase64: artifact.toString('base64'),
      }),
    })
    const text = await response.text()
    if (response.status === 409) {
      // eslint-disable-next-line no-console -- CLI progress output
      console.log(`skipped ${item.itemId}@${item.version} (already published)`)
      continue
    }
    if (!response.ok) fail(`${item.itemId}: hub answered ${response.status}: ${text}`)
    // eslint-disable-next-line no-console -- CLI progress output
    console.log(`published ${item.itemId}@${item.version} (${artifact.length} bytes)`)
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err))
})
