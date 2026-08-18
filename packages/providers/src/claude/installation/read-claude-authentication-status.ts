// `readClaudeAuthenticationStatus` — inspects the Claude Code CLI install +
// credential state and returns a typed `AuthenticationStatus`. The CLI's own
// `claude auth status` JSON is the authoritative read (email / org /
// subscription live only there — `.credentials.json` carries no identity);
// the env-var/settings API-key checks and the credentials-file read remain as
// the fallback for older CLIs whose status prints no JSON. Never throws on
// normal not-installed / not-authenticated states — those are returned as data.
//
// Vynel detects WHICH auth method the CLI uses; it never extracts or stores
// the API key value (decisions.md D14). Identity metadata (email, org, plan)
// is display data the CLI itself reports — not a credential. See blueprint §11.1.

import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveClaudeCodeExecutablePath } from './resolve-claude-code-executable-path.js'
import { readHostOsEnvVar } from './read-host-os-env-var.js'
import type {
  AuthenticationStatus,
  AuthenticationMethod,
} from '../../shared/authentication-status.js'

export async function readClaudeAuthenticationStatus(): Promise<AuthenticationStatus> {
  if (!checkClaudeCodeInstallation()) {
    return {
      providerId: 'claude',
      isInstalled: false,
      isAuthenticated: false,
      authenticatedAccountLabel: null,
      authenticationMethod: null,
      inactiveReason: 'Claude Code CLI is not installed',
      email: null,
      organizationName: null,
      subscriptionPlan: null,
    }
  }

  const credentials = await readCredentialsStatus()

  return {
    providerId: 'claude',
    isInstalled: true,
    isAuthenticated: credentials.isAuthenticated,
    authenticatedAccountLabel: credentials.accountLabel,
    authenticationMethod: credentials.method,
    inactiveReason: credentials.isAuthenticated ? null : credentials.reason,
    email: credentials.isAuthenticated ? credentials.email : null,
    organizationName: credentials.isAuthenticated ? credentials.organizationName : null,
    subscriptionPlan: credentials.isAuthenticated ? credentials.subscriptionPlan : null,
  }
}

function checkClaudeCodeInstallation(): boolean {
  try {
    const result = spawnSync(resolveClaudeCodeExecutablePath(), ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
    })
    return result.status === 0
  } catch {
    return false
  }
}

type CredentialsStatus =
  | {
      isAuthenticated: true
      accountLabel: string
      method: AuthenticationMethod
      reason: null
      email: string | null
      organizationName: string | null
      subscriptionPlan: string | null
    }
  | { isAuthenticated: false; accountLabel: null; method: null; reason: string }

const NOT_AUTHENTICATED: CredentialsStatus = {
  isAuthenticated: false,
  accountLabel: null,
  method: null,
  reason: 'Not authenticated',
}

// Resolution order matches Claude Code's own: env var → settings.json env
// key → the CLI's own `auth status` report → OAuth credentials file (the
// no-JSON fallback). Vynel detects PRESENCE only — it never reads the key
// value through.
async function readCredentialsStatus(): Promise<CredentialsStatus> {
  const apiKey: CredentialsStatus = {
    isAuthenticated: true,
    accountLabel: 'API Key',
    method: 'api-key',
    reason: null,
    email: null,
    organizationName: null,
    subscriptionPlan: null,
  }
  if (readHostOsEnvVar('ANTHROPIC_API_KEY') !== null) return apiKey
  if (await hasApiKeyInSettings()) return apiKey

  const reported = await readCliAuthStatus()
  if (reported !== null) return reported

  const oauth = await readOauthCredentials()
  if (oauth?.accessToken !== undefined) {
    if (oauth.expiresAt !== null && Date.now() > oauth.expiresAt) {
      return {
        isAuthenticated: false,
        accountLabel: null,
        method: null,
        reason: 'OAuth token has expired. Re-authenticate with `claude login`.',
      }
    }
    return {
      isAuthenticated: true,
      accountLabel: 'Authenticated',
      method: 'oauth',
      reason: null,
      email: null,
      organizationName: null,
      subscriptionPlan: null,
    }
  }

  return NOT_AUTHENTICATED
}

const execFileAsync = promisify(execFile)

/** The CLI's own answer (`claude auth status` prints JSON): loggedIn +
 *  authMethod ("claude.ai" = subscription OAuth) + email/orgName/
 *  subscriptionType. Null when the output carries no parseable JSON —
 *  an older CLI; the file-based fallback takes over. Async on purpose: the
 *  CLI boots for seconds, and a synchronous spawn here would freeze every
 *  live SSE stream in the process for that long. */
async function readCliAuthStatus(): Promise<CredentialsStatus | null> {
  let output: string
  try {
    const { stdout, stderr } = await execFileAsync(
      resolveClaudeCodeExecutablePath(),
      ['auth', 'status'],
      { timeout: 10_000, windowsHide: true },
    )
    output = `${stdout ?? ''}${stderr ?? ''}`
  } catch (error) {
    // A signed-out CLI can exit non-zero yet still print its JSON — read it.
    const failed = error as { stdout?: string; stderr?: string }
    output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`
    if (output === '') return null
  }

  // The JSON may sit after CLI preamble lines — slice the object out.
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(output.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const report = parsed as {
    loggedIn?: boolean
    authMethod?: string
    email?: string
    orgName?: string
    subscriptionType?: string
  }
  if (typeof report.loggedIn !== 'boolean') return null

  if (!report.loggedIn) return NOT_AUTHENTICATED

  const method: AuthenticationMethod = report.authMethod === 'claude.ai' ? 'oauth' : 'api-key'
  const email = typeof report.email === 'string' && report.email !== '' ? report.email : null
  return {
    isAuthenticated: true,
    accountLabel: email ?? (method === 'oauth' ? 'Authenticated' : 'API Key'),
    method,
    reason: null,
    email,
    organizationName:
      typeof report.orgName === 'string' && report.orgName !== '' ? report.orgName : null,
    subscriptionPlan:
      typeof report.subscriptionType === 'string' && report.subscriptionType !== ''
        ? report.subscriptionType
        : null,
  }
}

async function hasApiKeyInSettings(): Promise<boolean> {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      env?: { ANTHROPIC_API_KEY?: string }
    }
    return Boolean(parsed.env?.ANTHROPIC_API_KEY?.trim())
  } catch {
    return false
  }
}

type OauthCredentials = {
  accessToken: string
  expiresAt: number | null
}

async function readOauthCredentials(): Promise<OauthCredentials | null> {
  try {
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json')
    const parsed = JSON.parse(await readFile(credentialsPath, 'utf8')) as {
      claudeAiOauth?: { accessToken?: string; expiresAt?: number }
    }
    const oauth = parsed.claudeAiOauth
    if (oauth?.accessToken === undefined) {
      return null
    }
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
    }
  } catch {
    return null
  }
}
