// `readClaudeAuthenticationStatus` — inspects the Claude Code CLI install +
// credential state and returns a typed `AuthenticationStatus`. SDK-independent:
// it spawns `claude --version` and reads `~/.claude/{settings.json,
// .credentials.json}` directly. Never throws on normal not-installed /
// not-authenticated states — those are returned as data.
//
// Vynel detects WHICH auth method the CLI uses; it never extracts or stores
// the API key value (decisions.md D14). See blueprint §11.1.

import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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
  | { isAuthenticated: true; accountLabel: string; method: AuthenticationMethod; reason: null }
  | { isAuthenticated: false; accountLabel: null; method: null; reason: string }

// Resolution order matches Claude Code's own: env var → settings.json env
// key → OAuth credentials file. Vynel detects PRESENCE only — it never reads
// the key value through.
async function readCredentialsStatus(): Promise<CredentialsStatus> {
  if (readHostOsEnvVar('ANTHROPIC_API_KEY') !== null) {
    return { isAuthenticated: true, accountLabel: 'API Key', method: 'api-key', reason: null }
  }

  if (await hasApiKeyInSettings()) {
    return { isAuthenticated: true, accountLabel: 'API Key', method: 'api-key', reason: null }
  }

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
      accountLabel: oauth.accountLabel ?? 'Authenticated',
      method: 'oauth',
      reason: null,
    }
  }

  return { isAuthenticated: false, accountLabel: null, method: null, reason: 'Not authenticated' }
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
  accountLabel: string | null
}

async function readOauthCredentials(): Promise<OauthCredentials | null> {
  try {
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json')
    const parsed = JSON.parse(await readFile(credentialsPath, 'utf8')) as {
      claudeAiOauth?: { accessToken?: string; expiresAt?: number }
      email?: string
      user?: string
    }
    const oauth = parsed.claudeAiOauth
    if (oauth?.accessToken === undefined) {
      return null
    }
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
      accountLabel: parsed.email ?? parsed.user ?? null,
    }
  } catch {
    return null
  }
}
