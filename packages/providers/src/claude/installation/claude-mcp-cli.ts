// Drives the Agent SDK's bundled `claude` binary for MCP server auth —
// `claude mcp login/logout <name>` (verified in 2.1.213). The credential
// path stays Anthropic-native: the CLI runs the browser OAuth loop and
// stores tokens in ITS OS-managed encrypted store, which the same bundled
// runtime reads when a session connects to the server — Vynel never sees,
// holds, or forwards a credential. Sibling of `claude-plugin-cli.ts` (the
// delegate-to-native precedent).
//
// The CLI resolves project-scope (`.mcp.json`) servers from its working
// directory, so a workspace-installed server must be logged in with
// `workingDirectory` = the workspace path; user-config servers resolve
// from anywhere.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ValidationError } from '@vynel/errors'
import { resolveBundledClaudeBinary } from './claude-plugin-cli.js'
import { formatCliErrorDetail } from './format-cli-error-detail.js'

const execFileAsync = promisify(execFile)

// The login round-trip includes the user reading a consent screen in their
// browser — generous on purpose; a stuck flow still surfaces actionably.
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const LOGOUT_TIMEOUT_MS = 30 * 1000

export type ClaudeMcpAuthInput = {
  serverName: string
  /** Where the CLI resolves project-scope (`.mcp.json`) servers from. */
  workingDirectory?: string
  binaryPath?: string
}

/** Opens the user's browser for the server's OAuth flow and resolves when
 * the CLI records the credential. Exit ≠ 0 or timeout throws — the caller
 * surfaces it on the card. */
export async function loginClaudeMcpServer(input: ClaudeMcpAuthInput): Promise<void> {
  await runMcpAuthCommand('login', input, LOGIN_TIMEOUT_MS)
}

/** Clears the CLI's stored credential for the server. Callers treat this
 * as best-effort (a never-logged-in server has nothing to clear). */
export async function logoutClaudeMcpServer(input: ClaudeMcpAuthInput): Promise<void> {
  await runMcpAuthCommand('logout', input, LOGOUT_TIMEOUT_MS)
}

async function runMcpAuthCommand(
  command: 'login' | 'logout',
  input: ClaudeMcpAuthInput,
  timeout: number,
): Promise<void> {
  // This is the first place a serverName becomes CLI argv — a leading dash
  // would parse as a flag inside the CLI (no shell risk; just a confusing
  // failure), so refuse it at the boundary.
  if (input.serverName.startsWith('-')) {
    throw new ValidationError(
      `MCP server name '${input.serverName}' cannot start with '-'.`,
    )
  }
  const claudeBinary = input.binaryPath ?? resolveBundledClaudeBinary()
  try {
    await execFileAsync(claudeBinary, ['mcp', command, input.serverName], {
      timeout,
      windowsHide: true,
      ...(input.workingDirectory !== undefined ? { cwd: input.workingDirectory } : {}),
    })
  } catch (error) {
    const detail = formatCliErrorDetail((error as { stderr?: string }).stderr)
    const timedOut = (error as { killed?: boolean }).killed === true
    throw new ValidationError(
      command === 'login'
        ? `Connecting '${input.serverName}' ${timedOut ? 'timed out — finish the sign-in in your browser and try again' : `failed: ${detail || 'no error output'}`}.`
        : `Signing out of '${input.serverName}' failed: ${detail || 'no error output'}.`,
    )
  }
}
