// Generate the hub's TWO Ed25519 keypairs — access-token signing and
// artifact signing (separate pairs, so rotating one never invalidates the
// other) — printed as base64-encoded-PEM env lines. Run:
// `pnpm cloud:generate-keys` — paste the CLOUD_* lines into the hub's env
// and the VYNEL_HUB_ARTIFACT_KEY line into the desktop's. Re-running mints
// FRESH pairs: copy only the lines you mean to rotate.

import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'

async function pemPair(): Promise<{ privateB64: string; publicB64: string }> {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  return {
    privateB64: Buffer.from(await exportPKCS8(privateKey), 'utf8').toString('base64'),
    publicB64: Buffer.from(await exportSPKI(publicKey), 'utf8').toString('base64'),
  }
}

async function main(): Promise<void> {
  const tokens = await pemPair()
  const artifacts = await pemPair()
  /* eslint-disable no-console -- CLI output is the product here */
  console.log('# hub env (apps/cloud-api)')
  console.log(`CLOUD_ACCESS_TOKEN_PRIVATE_KEY=${tokens.privateB64}`)
  console.log(`CLOUD_ACCESS_TOKEN_PUBLIC_KEY=${tokens.publicB64}`)
  console.log(`CLOUD_ARTIFACT_SIGNING_PRIVATE_KEY=${artifacts.privateB64}`)
  console.log('# desktop env (each pair’s public half — token key, then artifact key)')
  console.log(`VYNEL_HUB_PUBLIC_KEY=${tokens.publicB64}`)
  console.log(`VYNEL_HUB_ARTIFACT_KEY=${artifacts.publicB64}`)
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- CLI error output
  console.error(err)
  // eslint-disable-next-line n/no-process-exit -- non-zero exit on failure
  process.exit(1)
})
