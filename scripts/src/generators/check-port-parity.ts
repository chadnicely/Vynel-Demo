// Port-parity guard. The engine port's ONE home is
// `packages/contracts/src/network/ports.ts` (VYNEL_ENGINE_PORT); every
// TypeScript consumer imports it. Two copies live where TypeScript can't
// reach — the Tauri shell (`daemon.rs`) and `tauri.conf.json`'s frontendDist
// — so this check fails `pnpm test` the moment they drift. Changing the
// product's port = edit the contracts constant, chase the failures this
// check names.
//
// Wired into `pnpm test` via `pnpm test:parity`.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

function extract(pattern: RegExp, text: string, sourceLabel: string): string {
  const match = pattern.exec(text)
  if (match?.[1] === undefined) {
    throw new Error(`check-port-parity: could not find the port in ${sourceLabel} (pattern ${pattern}).`)
  }
  return match[1]
}

const contractsSource = readFileSync(
  join(repoRoot, 'packages', 'contracts', 'src', 'network', 'ports.ts'),
  'utf8',
)
const enginePort = extract(/VYNEL_ENGINE_PORT = (\d+)/, contractsSource, 'contracts ports.ts')

const daemonRs = readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'daemon.rs'), 'utf8')
const tauriConf = readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8')

const copies = [
  {
    label: 'daemon.rs DAEMON_ADDRESS',
    value: extract(/DAEMON_ADDRESS: &str = "127\.0\.0\.1:(\d+)"/, daemonRs, 'daemon.rs DAEMON_ADDRESS'),
  },
  {
    label: 'daemon.rs PORT env',
    value: extract(/\.env\("PORT", "(\d+)"\)/, daemonRs, 'daemon.rs PORT env'),
  },
  {
    label: 'tauri.conf.json frontendDist',
    value: extract(/"frontendDist": "http:\/\/127\.0\.0\.1:(\d+)"/, tauriConf, 'tauri.conf.json frontendDist'),
  },
]

const drifted = copies.filter((copy) => copy.value !== enginePort)
if (drifted.length > 0) {
  console.error(
    `check-port-parity: FAILED — VYNEL_ENGINE_PORT is ${enginePort} but:\n` +
      drifted.map((copy) => ` - ${copy.label} says ${copy.value}`).join('\n'),
  )
  process.exit(1)
}
console.log(`check-port-parity: OK — engine port ${enginePort} consistent across contracts, daemon.rs, tauri.conf.json.`)
