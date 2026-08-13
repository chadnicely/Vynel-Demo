// Port-parity guard. The ports' ONE home is
// `packages/contracts/src/network/ports.ts`; every TypeScript consumer
// derives from it. Copies live where TypeScript can't reach — the Tauri
// shell's CANONICAL_ENGINE_PORT (daemon.rs, the PREFERRED first candidate of
// its per-boot allocation) and `tauri.conf.json`'s frontendDist/devUrl — so
// this check fails `pnpm test` the moment they drift. Changing a canonical
// port = edit the contracts literals, chase the failures this check names.
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
const localWebPort = extract(/VYNEL_LOCAL_WEB_PORT = (\d+)/, contractsSource, 'contracts ports.ts')

const daemonRs = readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'daemon.rs'), 'utf8')
const tauriConf = readFileSync(join(repoRoot, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8')

const copies = [
  {
    label: 'daemon.rs CANONICAL_ENGINE_PORT',
    expected: enginePort,
    value: extract(/CANONICAL_ENGINE_PORT: u16 = (\d+)/, daemonRs, 'daemon.rs CANONICAL_ENGINE_PORT'),
  },
  {
    label: 'tauri.conf.json frontendDist',
    expected: enginePort,
    value: extract(/"frontendDist": "http:\/\/127\.0\.0\.1:(\d+)"/, tauriConf, 'tauri.conf.json frontendDist'),
  },
  {
    label: 'tauri.conf.json devUrl',
    expected: localWebPort,
    value: extract(/"devUrl": "http:\/\/localhost:(\d+)"/, tauriConf, 'tauri.conf.json devUrl'),
  },
]

const drifted = copies.filter((copy) => copy.value !== copy.expected)
if (drifted.length > 0) {
  console.error(
    `check-port-parity: FAILED — contracts says engine ${enginePort} / local-web ${localWebPort} but:\n` +
      drifted.map((copy) => ` - ${copy.label} says ${copy.value} (expected ${copy.expected})`).join('\n'),
  )
  process.exit(1)
}
console.log(
  `check-port-parity: OK — engine ${enginePort} + local-web ${localWebPort} consistent across contracts, daemon.rs, tauri.conf.json.`,
)
