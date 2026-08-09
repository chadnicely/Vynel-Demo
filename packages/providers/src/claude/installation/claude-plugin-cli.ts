// Drives the Agent SDK's BUNDLED `claude` binary for plugin lifecycle — the
// delegate seam the marketplace's `plugin` kind installs through (Phase B:
// Anthropic distributes to their own user via their own tooling; Vynel only
// orchestrates). The binary ships in the SDK's platform package, so no
// standalone Claude Code install is required. All writes land in Claude
// Code's NATIVE layout (`~/.claude/plugins/` + settings `enabledPlugins`),
// which SDK sessions auto-load (smoked 2026-08-01) — native-disk interop by
// construction.

import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ValidationError } from '@vynel/errors'
import { formatCliErrorDetail } from './format-cli-error-detail.js'

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000

/** Two-hop resolution: providers → the SDK package → its platform package
 * (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`), where the binary
 * lives. Throws with the searched name so a missing platform package reads
 * as what it is. */
export function resolveBundledClaudeBinary(): string {
  const platformPackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
  const fromProviders = createRequire(import.meta.url)
  // Resolve the SDK's MAIN entry (its exports map blocks ./package.json),
  // then hop again from there — the platform package is the SDK's own
  // optional dep, invisible from providers directly under pnpm.
  const sdkMainEntry = fromProviders.resolve('@anthropic-ai/claude-agent-sdk')
  const fromSdk = createRequire(sdkMainEntry)
  let platformPackageJson: string
  try {
    platformPackageJson = fromSdk.resolve(`${platformPackage}/package.json`)
  } catch {
    throw new ValidationError(
      `The Claude engine binary for this platform (${platformPackage}) is not installed — ` +
        'reinstall dependencies or update @anthropic-ai/claude-agent-sdk.',
    )
  }
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
  return path.join(path.dirname(platformPackageJson), binaryName)
}

// Exported for the marketplace-cli sibling — `plugin marketplace …`
// subcommands ride the same runner (one exec home, one error shape).
export async function runPluginCommand(args: string[], binaryPath?: string): Promise<string> {
  const claudeBinary = binaryPath ?? resolveBundledClaudeBinary()
  try {
    const { stdout } = await execFileAsync(claudeBinary, ['plugin', ...args], {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    })
    return stdout
  } catch (error) {
    const detail = formatCliErrorDetail((error as { stderr?: string }).stderr)
    throw new ValidationError(
      `The Claude plugin command failed (plugin ${args[0] ?? ''}): ${detail || 'no error output'}`,
    )
  }
}

export type InstallClaudePluginInput = {
  /** GitHub `owner/repo` (or git URL) of the plugin marketplace. */
  marketplaceRepo: string
  /** The marketplace's self-declared name (its marketplace.json `name`). */
  marketplaceName: string
  pluginName: string
  binaryPath?: string
  /** Test seam only (mirrors `listInstalledClaudePlugins`) — where the
   * known-marketplaces registry is read from. */
  homeDir?: string
}

/** One reference, many spellings: `owner/repo`, its https URL, with or
 * without `.git`/trailing slash all name the same marketplace — the
 * mismatch guard must compare THIS form, or a shorthand-registered
 * marketplace refuses installs against its own rendered URL. */
export function canonicalMarketplaceRef(ref: string): string {
  const trimmed = ref
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  const githubPath = trimmed.match(/^https:\/\/github\.com\/(.+)$/)
  return githubPath !== null ? githubPath[1]! : trimmed
}

/** Idempotent marketplace registration + user-scope install. The CLI itself
 * clones the marketplace, copies the plugin into its cache, records it in
 * `installed_plugins.json`, and flips `enabledPlugins` — one install that
 * works in Vynel sessions AND Claude Code direct use. */
export async function installClaudePlugin(input: InstallClaudePluginInput): Promise<void> {
  assertSafePluginKeyParts(input.pluginName, input.marketplaceName)
  const known = readKnownClaudeMarketplaces(input.homeDir)
  const registered = known[input.marketplaceName]
  if (registered === undefined) {
    await runPluginCommand(['marketplace', 'add', input.marketplaceRepo], input.binaryPath)
  } else {
    // The trust story of the delegate: `marketplaceRepo` is honored on
    // first registration only, so a SAME-NAMED marketplace already
    // registered against a different repo would silently supply the
    // plugin. Refuse instead of installing from the wrong source. Both
    // registration shapes count (`github.repo` shorthand / `git.url`),
    // compared canonically; a BLANK side skips the check — the caller
    // couldn't name the origin (a row-fact install from an unrecognized
    // registration shape), and the user's registration stays the anchor.
    const registrationSource = (registered as { source?: { repo?: string; url?: string } }).source
    const registeredRef = registrationSource?.repo ?? registrationSource?.url
    if (
      registeredRef !== undefined &&
      input.marketplaceRepo.trim() !== '' &&
      canonicalMarketplaceRef(registeredRef) !== canonicalMarketplaceRef(input.marketplaceRepo)
    ) {
      throw new ValidationError(
        `A plugin marketplace named '${input.marketplaceName}' is already registered from ` +
          `'${registeredRef}' — expected '${input.marketplaceRepo}'. Remove it in Claude Code first.`,
      )
    }
  }
  await runPluginCommand(
    ['install', `${input.pluginName}@${input.marketplaceName}`, '--scope', 'user'],
    input.binaryPath,
  )
}

// The composed `name@marketplace` becomes CLI argv in every plugin command,
// and Move A made plugin names attacker-influenced (a hostile clone's
// marketplace.json) — a dash-leading half would parse as a flag. Same
// defense class as the marketplace-cli argv guard.
function assertSafePluginKeyParts(pluginName: string, marketplaceName: string): void {
  for (const part of [pluginName, marketplaceName]) {
    if (part.trim().length === 0 || part.startsWith('-')) {
      throw new ValidationError(
        `Plugin key part '${part}' is empty or starts with '-' — refusing to drive the CLI with it.`,
      )
    }
  }
}

export async function uninstallClaudePlugin(input: {
  pluginName: string
  marketplaceName: string
  binaryPath?: string
}): Promise<void> {
  assertSafePluginKeyParts(input.pluginName, input.marketplaceName)
  await runPluginCommand(
    ['uninstall', `${input.pluginName}@${input.marketplaceName}`, '--scope', 'user'],
    input.binaryPath,
  )
}

/** In-place update to the marketplace's current version — the CLI refreshes
 * its clone of the plugin marketplace and replaces the cached plugin
 * (previously: uninstall + reinstall). Same native-layout guarantee as
 * install. No `--scope` flag, unlike install/uninstall: update operates on
 * the already-installed entry keyed by `name@marketplace`, where scope was
 * fixed at install time. */
export async function updateClaudePlugin(input: {
  pluginName: string
  marketplaceName: string
  binaryPath?: string
}): Promise<void> {
  assertSafePluginKeyParts(input.pluginName, input.marketplaceName)
  await runPluginCommand(
    ['update', `${input.pluginName}@${input.marketplaceName}`],
    input.binaryPath,
  )
}

export type InstalledClaudePluginView = {
  /** `<pluginName>@<marketplaceName>` — the registry key and the ONLY match
   * anchor (a same-named plugin from another marketplace must never
   * cross-match; the agents-slug precedent). */
  key: string
  pluginName: string
  marketplaceName: string
  /** null when the registry records 'unknown'. */
  version: string | null
}

type InstalledPluginsFile = {
  version?: number
  plugins?: Record<
    string,
    Array<{ scope?: string; version?: string; installedAt?: string; lastUpdated?: string }>
  >
}

/** Reads Claude Code's install registry (`~/.claude/plugins/
 * installed_plugins.json`, v2). USER-scope entries only — project-scope
 * installs belong to their repos, not to Vynel's global marketplace. A
 * missing or unparsable file is "nothing installed", never an error (the
 * user may simply never have used plugins). SYNC on purpose — it feeds the
 * marketplace's sync annotation pipeline. */
export function listInstalledClaudePlugins(
  homeDir = os.homedir(),
): InstalledClaudePluginView[] {
  const registryPath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json')
  let parsed: InstalledPluginsFile
  try {
    parsed = JSON.parse(readFileSync(registryPath, 'utf8'))
  } catch {
    return []
  }
  const views: InstalledClaudePluginView[] = []
  for (const [key, entries] of Object.entries(parsed.plugins ?? {})) {
    if (!Array.isArray(entries) || !entries.some((entry) => entry?.scope === 'user')) continue
    // Plugin names never contain '@' — the FIRST '@' is the split.
    const atIndex = key.indexOf('@')
    if (atIndex <= 0 || atIndex === key.length - 1) continue
    // Duplicate entries per key exist in real registries — newest wins.
    const newest = entries
      .filter((entry) => entry?.scope === 'user')
      .sort((a, b) =>
        (b.lastUpdated ?? b.installedAt ?? '').localeCompare(a.lastUpdated ?? a.installedAt ?? ''),
      )[0]!
    const version = newest.version
    views.push({
      key,
      pluginName: key.slice(0, atIndex),
      marketplaceName: key.slice(atIndex + 1),
      version: version === undefined || version === 'unknown' ? null : version,
    })
  }
  return views
}

type KnownMarketplacesFile = Record<string, unknown>

function readKnownClaudeMarketplaces(homeDir = os.homedir()): KnownMarketplacesFile {
  const knownPath = path.join(homeDir, '.claude', 'plugins', 'known_marketplaces.json')
  try {
    const parsed = JSON.parse(readFileSync(knownPath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as KnownMarketplacesFile) : {}
  } catch {
    return {}
  }
}
