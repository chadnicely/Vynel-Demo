// Is the REMOTE engine signed in to Claude? Runs the CLI's own `auth status`
// over a one-shot exec and reports presence only — never a credential value
// (decision D14). Used before offering sign-in, and to confirm afterwards.

import type { ServerConnection } from '../connecting/server-connection.js'
import { CLAUDE_STATUS_COMMAND } from './claude-auth-relay.js'

export interface RemoteClaudeAuthStatus {
  isSignedIn: boolean
  /** The CLI's own words — shown as-is; it names the account when signed in. */
  detail: string
}

export async function readRemoteClaudeAuthStatus(
  connection: ServerConnection,
): Promise<RemoteClaudeAuthStatus> {
  const result = await connection.exec(CLAUDE_STATUS_COMMAND, { timeoutMs: 30_000 })
  const detail = (result.stdout || result.stderr).trim().slice(0, 400)
  // The CLI exits non-zero when it has no credentials; treat any other
  // failure the same way (not signed in) and let `detail` explain.
  return { isSignedIn: result.exitCode === 0, detail }
}
