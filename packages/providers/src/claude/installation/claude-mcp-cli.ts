// Drives the Agent SDK's bundled `claude` binary for MCP server auth —
// `claude mcp login/logout <name>` (verified in 2.1.213). The credential
// path stays Anthropic-native: the CLI runs the browser OAuth loop and
// stores tokens in ITS OS-managed encrypted store, which the same bundled
// runtime reads when a session connects to the server — Vynel never sees,
// holds, or forwards a credential. Sibling of `claude-plugin-cli.ts` (the
// delegate-to-native precedent).
//
// LOGIN NEEDS A CONSOLE (smoked 2026-08-09): the CLI aborts when
// `stdin.isTTY` is false — in BOTH modes, even after arming its loopback
// callback ("stdin isn't a terminal … re-run in an interactive terminal").
// No pipe-based spawn can ever pass that check, so on Windows the login
// runs through `Start-Process -WindowStyle Hidden`: the child gets a real
// (invisible) console — probed: stdin.isTTY true — and the default flow
// proceeds: browser opens, loopback completes, process exits. The child's
// console output is unreachable that way, so login errors are exit-code
// based. Logout is non-interactive and keeps the plain pipe spawn (stderr
// detail intact).
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
const LOGIN_TIMEOUT_SECONDS = 5 * 60
const LOGOUT_TIMEOUT_MS = 30 * 1000
// The wrapper enforces its own timeout; the outer guard only catches a
// wedged PowerShell itself.
const LOGIN_WRAPPER_TIMEOUT_MS = (LOGIN_TIMEOUT_SECONDS + 30) * 1000
const LOGIN_TIMED_OUT_EXIT_CODE = 124

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
  assertSafeServerName(input.serverName)
  const claudeBinary = input.binaryPath ?? resolveBundledClaudeBinary()
  if (process.platform !== 'win32') {
    // Non-Windows has no hidden-console equivalent from Node; the plain
    // spawn hits the CLI's TTY check and reports its own actionable error.
    // Revisit with a pty seam when a non-Windows desktop ships.
    await runPipedMcpAuthCommand('login', input, claudeBinary, LOGIN_WRAPPER_TIMEOUT_MS)
    return
  }
  const script = buildHiddenConsoleLoginScript(
    claudeBinary,
    input.serverName,
    input.workingDirectory,
  )
  let exitCode = 0
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: LOGIN_WRAPPER_TIMEOUT_MS,
      windowsHide: true,
    })
  } catch (error) {
    exitCode = typeof (error as { code?: number }).code === 'number'
      ? (error as { code: number }).code
      : 1
  }
  if (exitCode === LOGIN_TIMED_OUT_EXIT_CODE) {
    throw new ValidationError(
      `Connecting '${input.serverName}' timed out — finish the sign-in in your browser and try again.`,
    )
  }
  if (exitCode !== 0) {
    throw new ValidationError(
      `Connecting '${input.serverName}' didn't complete — the sign-in was cancelled or failed. Try Connect again.`,
    )
  }
}

/** The PowerShell wrapper: hidden console (the CLI's stdin.isTTY check
 * passes), wait bounded, kill on timeout, exit with the child's code.
 * Exported for its tests — the real spawn needs a browser round-trip. */
export function buildHiddenConsoleLoginScript(
  binaryPath: string,
  serverName: string,
  workingDirectory?: string,
): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
  const workingDirectoryArg =
    workingDirectory !== undefined ? ` -WorkingDirectory ${quote(workingDirectory)}` : ''
  return (
    `$p = Start-Process -FilePath ${quote(binaryPath)} ` +
    `-ArgumentList 'mcp','login',${quote(serverName)} ` +
    `-WindowStyle Hidden -PassThru${workingDirectoryArg}; ` +
    `Wait-Process -Id $p.Id -Timeout ${LOGIN_TIMEOUT_SECONDS} -ErrorAction SilentlyContinue; ` +
    `if (-not $p.HasExited) { Stop-Process -Force -Id $p.Id; exit ${LOGIN_TIMED_OUT_EXIT_CODE} } ` +
    `exit $p.ExitCode`
  )
}

/** Clears the CLI's stored credential for the server. Callers treat this
 * as best-effort (a never-logged-in server has nothing to clear). */
export async function logoutClaudeMcpServer(input: ClaudeMcpAuthInput): Promise<void> {
  assertSafeServerName(input.serverName)
  const claudeBinary = input.binaryPath ?? resolveBundledClaudeBinary()
  await runPipedMcpAuthCommand('logout', input, claudeBinary, LOGOUT_TIMEOUT_MS)
}

// This is the first place a serverName becomes CLI argv — a leading dash
// would parse as a flag inside the CLI (no shell risk; just a confusing
// failure), so refuse it at the boundary.
function assertSafeServerName(serverName: string): void {
  if (serverName.startsWith('-')) {
    throw new ValidationError(`MCP server name '${serverName}' cannot start with '-'.`)
  }
}

async function runPipedMcpAuthCommand(
  command: 'login' | 'logout',
  input: ClaudeMcpAuthInput,
  claudeBinary: string,
  timeout: number,
): Promise<void> {
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
