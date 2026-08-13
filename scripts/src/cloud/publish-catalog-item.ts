// Publish a marketplace item to the hub. A bundle directory holds a
// `vynel-item.json` (publisher/item/version/manifest) plus the files that
// make up the artifact; everything except the metadata file is zipped, the
// zip is base64'd, and POSTed to /admin/catalog/publish.
//
//   pnpm cloud:publish scripts/seed-catalog/email-drafter
//
// Env: CLOUD_ADMIN_TOKEN (required); VYNEL_HUB_URL or --url (default
// http://localhost:18890). An operator/dev tool — reads process.env directly.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import JSZip from 'jszip'
import { VYNEL_CLOUD_API_PORT } from '@vynel/contracts/network/ports'

const METADATA_FILE = 'vynel-item.json'

function fail(message: string): never {
  // eslint-disable-next-line no-console -- CLI error channel
  console.error(`publish: ${message}`)
  // eslint-disable-next-line n/no-process-exit -- CLI non-zero exit
  process.exit(1)
}

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) listFiles(full, base, out)
    else out.push(relative(base, full))
  }
  return out
}

async function main(): Promise<void> {
  const bundleDir = process.argv[2]
  if (bundleDir === undefined) fail('usage: cloud:publish <bundle-dir>')
  const urlFlag = process.argv.indexOf('--url')
  const hubUrl = (
    urlFlag !== -1 ? process.argv[urlFlag + 1] : process.env['VYNEL_HUB_URL']
  )?.replace(/\/+$/, '') ?? `http://localhost:${VYNEL_CLOUD_API_PORT}`
  const adminToken = process.env['CLOUD_ADMIN_TOKEN']
  if (adminToken === undefined || adminToken === '') fail('CLOUD_ADMIN_TOKEN is not set')

  let metadata: Record<string, unknown>
  try {
    metadata = JSON.parse(readFileSync(join(bundleDir, METADATA_FILE), 'utf8'))
  } catch {
    fail(`could not read ${join(bundleDir, METADATA_FILE)}`)
  }

  // Zip every bundle file except the metadata.
  const zip = new JSZip()
  const files = listFiles(bundleDir).filter((f) => f !== METADATA_FILE)
  if (files.length === 0) fail('bundle has no artifact files (only vynel-item.json)')
  for (const rel of files) {
    zip.file(rel.split(sep).join('/'), readFileSync(join(bundleDir, rel)))
  }
  const artifact = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  const response = await fetch(`${hubUrl}/admin/catalog/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ ...metadata, artifactBase64: artifact.toString('base64') }),
  })
  const text = await response.text()
  if (!response.ok) fail(`hub answered ${response.status}: ${text}`)
  // eslint-disable-next-line no-console -- CLI success output
  console.log(`published: ${text} (${files.length} file(s), ${artifact.length} bytes)`)
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err))
})
