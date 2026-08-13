// Worktree port-band allocator (`pnpm worktree:env`). Run INSIDE a fresh
// worktree checkout: copies the main checkout's `.env`, finds a free port
// band, and writes `VYNEL_PORT_BASE=<band>` so the worktree's whole instance
// (engine, voice, web dev servers, every derived URL) runs beside the main
// checkout without a single collision.
//
// Band selection: claimed bands (main `.env` + every sibling worktree's
// `.env`) are skipped even when not running — two stopped worktrees must not
// claim the same band. Remaining candidates are bind-probed (all five ports)
// so Docker/Hyper-V reserved ranges are skipped too.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  VYNEL_PORT_BASE_DEFAULT,
  VYNEL_PORT_OFFSETS,
  resolveVynelPorts,
} from '@vynel/contracts/network/ports'

const BAND_STRIDE = 10
const WORKTREES_SEGMENT = join('.claude', 'worktrees')

/** The `VYNEL_PORT_BASE` a `.env` text claims (its own or the canonical default). */
export function readPortBaseFromEnvText(envText: string): number {
  const match = /^\s*VYNEL_PORT_BASE\s*=\s*(\d+)\s*$/m.exec(envText)
  if (match?.[1] === undefined) return VYNEL_PORT_BASE_DEFAULT
  return Number(match[1])
}

/** Rewrite a `.env` text to claim `portBase` — replaces an existing
 *  assignment (commented or not) or appends one. */
export function withPortBase(envText: string, portBase: number): string {
  const assignment = `VYNEL_PORT_BASE=${portBase}`
  const existing = /^\s*#?\s*VYNEL_PORT_BASE\s*=.*$/m
  if (existing.test(envText)) return envText.replace(existing, assignment)
  const separator = envText === '' || envText.endsWith('\n') ? '' : '\n'
  return `${envText}${separator}\n# Worktree band — allocated by \`pnpm worktree:env\`.\n${assignment}\n`
}

/** First band ≥ the canonical one that is neither claimed nor occupied.
 *  `isBandFree` is injected so tests never touch real sockets. */
export async function findFreeBand(
  claimedBases: Set<number>,
  isBandFree: (portBase: number) => Promise<boolean>,
): Promise<number> {
  const highestOffset = Math.max(...Object.values(VYNEL_PORT_OFFSETS))
  const highestBase = 65_535 - highestOffset
  for (
    let candidate = VYNEL_PORT_BASE_DEFAULT + BAND_STRIDE;
    candidate <= highestBase;
    candidate += BAND_STRIDE
  ) {
    if (claimedBases.has(candidate)) continue
    if (await isBandFree(candidate)) return candidate
  }
  throw new Error(
    'setup-worktree-env: no free port band found — remove stale worktrees or free the bands their .env files claim.',
  )
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const probe = createServer()
    probe.once('error', () => resolveProbe(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolveProbe(true)))
  })
}

async function bandIsFree(portBase: number): Promise<boolean> {
  const ports = Object.values(resolveVynelPorts(portBase))
  for (const port of ports) {
    if (!(await portIsFree(port))) return false
  }
  return true
}

/** The main checkout's root when `checkoutRoot` is a worktree under
 *  `.claude/worktrees/`; null when it IS the main checkout. */
export function findMainRootFor(checkoutRoot: string): string | null {
  const marker = `${sep}${WORKTREES_SEGMENT}${sep}`
  const markerIndex = checkoutRoot.lastIndexOf(marker)
  if (markerIndex === -1) return null
  return checkoutRoot.slice(0, markerIndex)
}

function claimedBases(mainRoot: string): Set<number> {
  const claimed = new Set<number>()
  const mainEnvPath = join(mainRoot, '.env')
  claimed.add(existsSync(mainEnvPath) ? readPortBaseFromEnvText(readFileSync(mainEnvPath, 'utf8')) : VYNEL_PORT_BASE_DEFAULT)
  const worktreesDir = join(mainRoot, WORKTREES_SEGMENT)
  if (!existsSync(worktreesDir)) return claimed
  for (const entry of readdirSync(worktreesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const envPath = join(worktreesDir, entry.name, '.env')
    if (existsSync(envPath)) claimed.add(readPortBaseFromEnvText(readFileSync(envPath, 'utf8')))
  }
  return claimed
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url))
  const checkoutRoot = resolve(here, '..', '..', '..') // dev -> src -> scripts -> checkout root
  const mainRoot = findMainRootFor(checkoutRoot)
  if (mainRoot === null) {
    console.log(
      `setup-worktree-env: ${checkoutRoot} is the main checkout — it keeps the canonical band (${VYNEL_PORT_BASE_DEFAULT}). Nothing to do.`,
    )
    return
  }

  const worktreeEnvPath = join(checkoutRoot, '.env')
  if (existsSync(worktreeEnvPath)) {
    const existingText = readFileSync(worktreeEnvPath, 'utf8')
    if (/^\s*VYNEL_PORT_BASE\s*=/m.test(existingText)) {
      console.log(
        `setup-worktree-env: ${worktreeEnvPath} already claims band ${readPortBaseFromEnvText(existingText)}. Nothing to do.`,
      )
      return
    }
  }

  const mainEnvPath = join(mainRoot, '.env')
  const sourceText = existsSync(worktreeEnvPath)
    ? readFileSync(worktreeEnvPath, 'utf8')
    : existsSync(mainEnvPath)
      ? readFileSync(mainEnvPath, 'utf8')
      : ''

  if (/^\s*DB_PATH\s*=\s*[A-Za-z]:[\\/]|^\s*DB_PATH\s*=\s*\//m.test(sourceText)) {
    console.warn(
      'setup-worktree-env: WARNING — the copied .env sets an ABSOLUTE DB_PATH; both checkouts would share one database. Make it relative (./.data/vynel.dev.db) for a per-worktree DB.',
    )
  }

  const band = await findFreeBand(claimedBases(mainRoot), bandIsFree)
  writeFileSync(worktreeEnvPath, withPortBase(sourceText, band))
  const ports = resolveVynelPorts(band)
  console.log(
    `setup-worktree-env: claimed band ${band} for ${checkoutRoot}\n` +
      `  engine ${ports.engine} · voice ${ports.voiceDaemon} · local-web ${ports.localWeb} · cloud-api ${ports.cloudApi} · cloud-admin ${ports.cloudAdminWeb}`,
  )
}

const isDirectRun =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
