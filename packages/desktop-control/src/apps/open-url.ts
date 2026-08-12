// Opening a URL in its default app — item 11's "open", delivered WITHOUT the
// `open` npm package: launch-app.ts already owns the safe-spawn pattern
// (env-var passing, no interpolation), and one more dependency buys nothing
// over one more small file beside it.
//
// A URL opener is a LAUNCHER, so the allowlist is the whole point. ShellExecute
// on an arbitrary string is the unrestricted-execution hole `isLaunchableAppId`
// exists to prevent: `file:///C:/...whatever.exe` RUNS the exe, and a bare
// UNC/local path does too. Only web-class schemes pass; deep-link schemes
// (zoommtg:, msteams:) are a SEPARATE, riskier decision (module notes item 12)
// and are deliberately not here.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const OPEN_TIMEOUT_MS = 15_000
const URL_MAX_LENGTH = 2048

/** Web-class only. `mailto:` composes, never sends — the send stays with the
 *  user in their mail app, which is the reversibility line this package draws
 *  everywhere. */
export const OPEN_URL_ALLOWED_SCHEMES = ['https:', 'http:', 'mailto:'] as const

export type OpenUrlRefusal = { ok: false; reason: string }
export type OpenUrlAccepted = { ok: true; url: URL }

/** Validate a raw string into an openable URL, or say exactly why not. */
export function checkOpenableUrl(raw: string): OpenUrlAccepted | OpenUrlRefusal {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'A URL is required.' }
  if (trimmed.length > URL_MAX_LENGTH) {
    return { ok: false, reason: `The URL is longer than ${URL_MAX_LENGTH} characters.` }
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return {
      ok: false,
      reason: `"${trimmed.slice(0, 80)}" is not an absolute URL. Pass the full address, scheme included (https://…).`,
    }
  }
  if (!(OPEN_URL_ALLOWED_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    return {
      ok: false,
      reason:
        `The "${parsed.protocol.replace(/:$/, '')}" scheme is not allowed — only ` +
        `${OPEN_URL_ALLOWED_SCHEMES.map((scheme) => scheme.replace(/:$/, '')).join(', ')} open here. ` +
        'File paths and app deep-links are deliberately out: opening them can execute programs.',
    }
  }
  // http://user:pass@host is a credential in a URL — this package never
  // handles credentials, and such links are the classic phishing shape.
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'URLs carrying a username or password are refused.' }
  }
  // mailto:?attach=C:\… asks the mail client to pull a LOCAL FILE into the
  // draft. Modern clients ignore it for exactly this reason, but compose-only
  // is THIS package's promise — not one to delegate to the mail client.
  if (parsed.protocol === 'mailto:') {
    for (const param of ['attach', 'attachment']) {
      if (parsed.searchParams.has(param)) {
        return { ok: false, reason: 'mailto links with attachment parameters are refused.' }
      }
    }
  }
  return { ok: true, url: parsed }
}

// Named, not inline — the invocation test asserts the command dereferences
// exactly this (the launch-app lesson).
const OPEN_URL_VARIABLE = 'VYNEL_OPEN_URL'

/** The exact PowerShell invocation, separated from the spawn for tests. The
 *  URL rides an env var: under `-Command`, `-Args` is silently ignored (the
 *  launch-app trapdoor) and interpolation would let a crafted URL become a
 *  second statement. */
export function buildOpenUrlInvocation(url: string): {
  args: string[]
  env: Record<string, string>
} {
  return {
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Start-Process -FilePath $env:${OPEN_URL_VARIABLE}`,
    ],
    env: { [OPEN_URL_VARIABLE]: url },
  }
}

/** Open a VALIDATED URL in its default app. The caller runs `checkOpenableUrl`
 *  first (the tool refuses before this point); this re-checks anyway — the
 *  allowlist must hold even if a future caller forgets. */
export async function openUrl(
  raw: string,
  deps: { run?: (args: string[], env: Record<string, string>) => Promise<void> } = {},
): Promise<URL> {
  const checked = checkOpenableUrl(raw)
  if (!checked.ok) throw new Error(checked.reason)
  const invocation = buildOpenUrlInvocation(checked.url.href)
  const run =
    deps.run ??
    (async (args: string[], env: Record<string, string>): Promise<void> => {
      if (process.platform !== 'win32') {
        throw new Error('Opening URLs is supported on Windows only.')
      }
      await execFileAsync('powershell', args, {
        windowsHide: true,
        timeout: OPEN_TIMEOUT_MS,
        env: { ...process.env, ...env },
      })
    })
  await run(invocation.args, invocation.env)
  return checked.url
}
