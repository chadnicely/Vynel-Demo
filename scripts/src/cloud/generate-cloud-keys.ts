// Generate the hub's Ed25519 access-token keypair, printed as the two
// base64-encoded-PEM env lines apps/cloud-api/src/env.ts expects.
// Run: `pnpm cloud:generate-keys` — paste the output into the hub's env.

import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'

async function main(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  const privatePem = await exportPKCS8(privateKey)
  const publicPem = await exportSPKI(publicKey)
  /* eslint-disable no-console -- CLI output is the product here */
  console.log(`CLOUD_ACCESS_TOKEN_PRIVATE_KEY=${Buffer.from(privatePem, 'utf8').toString('base64')}`)
  console.log(`CLOUD_ACCESS_TOKEN_PUBLIC_KEY=${Buffer.from(publicPem, 'utf8').toString('base64')}`)
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- CLI error output
  console.error(err)
  // eslint-disable-next-line n/no-process-exit -- non-zero exit on failure
  process.exit(1)
})
