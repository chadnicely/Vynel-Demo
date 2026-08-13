// Dev launcher — `pnpm dev [apps...] [--base 28890 | --port 28892]`.
// No apps = today's default trio (cloud-api + local-api + local-web, with
// the hub DB up). App names pick the set; `--base` shifts the WHOLE port
// band (VYNEL_PORT_BASE — every port and derived URL follows); `--port`
// names the ENGINE port and derives the band from it, so `--port 28892`
// and `--base 28890` mean the same instance. Real env beats `.env` in every
// app (node --env-file never overrides existing vars; vite spreads
// process.env last), which is what lets one flag steer everything.

import { spawn, spawnSync } from 'node:child_process'
import {
  VYNEL_PORT_OFFSETS,
  parseVynelPortBase,
  resolveVynelPorts,
} from '@vynel/contracts/network/ports'

const APP_ALIASES: Record<string, string> = {
  'api': '@vynel/local-api',
  'engine': '@vynel/local-api',
  'local-api': '@vynel/local-api',
  'web': '@vynel/local-web',
  'ui': '@vynel/local-web',
  'local-web': '@vynel/local-web',
  'cloud': '@vynel/cloud-api',
  'hub': '@vynel/cloud-api',
  'cloud-api': '@vynel/cloud-api',
  'admin': '@vynel/cloud-admin-web',
  'cloud-admin': '@vynel/cloud-admin-web',
  'cloud-admin-web': '@vynel/cloud-admin-web',
  'voice': '@vynel/voice-daemon',
  'voice-daemon': '@vynel/voice-daemon',
  'worker': '@vynel/worker',
  'desktop': '@vynel/desktop',
  'shell': '@vynel/desktop',
}

const DEFAULT_FILTERS = ['@vynel/cloud-api', '@vynel/local-api', '@vynel/local-web']
// The hub side needs its Postgres container before it can boot.
const DATABASE_FILTERS = new Set(['@vynel/cloud-api', '@vynel/cloud-admin-web'])

export interface DevCommand {
  filters: string[]
  portBase: number | undefined
  needsDatabase: boolean
}

export function usage(): string {
  const names = Object.keys(APP_ALIASES).join(', ')
  return (
    'usage: pnpm dev [apps...] [--base <portBase> | --port <enginePort>]\n' +
    `  apps: ${names}\n` +
    '  no apps = cloud + api + web (the classic pnpm dev)\n' +
    '  --base 28890   shift the whole port band (VYNEL_PORT_BASE)\n' +
    '  --port 28892   same, named by the engine port (base = port - ' +
    `${VYNEL_PORT_OFFSETS.engine})`
  )
}

function parseNumericFlag(value: string, flag: string): number {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isInteger(parsed)) {
    throw new Error(`${flag} "${value}" is not a port number.\n${usage()}`)
  }
  return parsed
}

function toPortBase(candidateBase: number, flag: string): number {
  try {
    return parseVynelPortBase(String(candidateBase))
  } catch {
    throw new Error(`${flag}: band base ${candidateBase} is outside the valid port range.\n${usage()}`)
  }
}

function takeFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} needs a value.\n${usage()}`)
  }
  return value
}

export function parseDevCommand(argv: string[]): DevCommand {
  const filters: string[] = []
  let base: string | undefined
  let enginePort: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined || argument === '--') continue
    if (argument === '--base') {
      base = takeFlagValue(argv, index, '--base')
      index += 1
    } else if (argument === '--port') {
      enginePort = takeFlagValue(argv, index, '--port')
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown flag ${argument}.\n${usage()}`)
    } else {
      const filter = APP_ALIASES[argument.toLowerCase()]
      if (filter === undefined) {
        throw new Error(`unknown app "${argument}".\n${usage()}`)
      }
      if (!filters.includes(filter)) filters.push(filter)
    }
  }

  if (base !== undefined && enginePort !== undefined) {
    throw new Error(`pass --base OR --port, not both.\n${usage()}`)
  }
  let portBase: number | undefined
  if (enginePort !== undefined) {
    portBase = toPortBase(parseNumericFlag(enginePort, '--port') - VYNEL_PORT_OFFSETS.engine, '--port')
  } else if (base !== undefined) {
    portBase = toPortBase(parseNumericFlag(base, '--base'), '--base')
  }

  const chosenFilters = filters.length > 0 ? filters : [...DEFAULT_FILTERS]
  return {
    filters: chosenFilters,
    portBase,
    needsDatabase: chosenFilters.some((filter) => DATABASE_FILTERS.has(filter)),
  }
}

function run(command: string, args: string[], extraEnv: Record<string, string>): Promise<number> {
  const child = spawn(command, args, {
    stdio: 'inherit',
    // Windows needs a shell to resolve pnpm.cmd; every argument here comes
    // from the alias whitelist or numeric validation — nothing user-shaped
    // reaches the shell raw.
    shell: true,
    env: { ...process.env, ...extraEnv },
  })
  return new Promise((resolveExit) => {
    child.on('exit', (code) => resolveExit(code ?? 1))
    child.on('error', (error) => {
      console.error(`dev: failed to start ${command}: ${error.message}`)
      resolveExit(1)
    })
  })
}

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2)
  if (rawArguments.includes('--help') || rawArguments.includes('-h')) {
    console.log(usage())
    return
  }
  const command = parseDevCommand(rawArguments)
  const extraEnv: Record<string, string> = {}
  if (command.portBase !== undefined) {
    extraEnv['VYNEL_PORT_BASE'] = String(command.portBase)
    const ports = resolveVynelPorts(command.portBase)
    console.log(
      `dev: band ${command.portBase} — engine ${ports.engine} · web ${ports.localWeb} · ` +
        `voice ${ports.voiceDaemon} · cloud ${ports.cloudApi} · admin ${ports.cloudAdminWeb}`,
    )
  }
  if (command.needsDatabase) {
    const database = spawnSync('pnpm', ['db:up'], { stdio: 'inherit', shell: true })
    if (database.status !== 0) {
      console.error('dev: pnpm db:up failed — the hub apps need their Postgres container.')
      process.exit(database.status ?? 1)
    }
  }
  const filterArguments = command.filters.map((filter) => `--filter=${filter}`)
  const code = await run('pnpm', ['exec', 'turbo', 'run', 'dev', ...filterArguments, '--no-daemon'], extraEnv)
  process.exit(code)
}

const isDirectRun = process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/src/dev/dev.ts') ?? false
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
