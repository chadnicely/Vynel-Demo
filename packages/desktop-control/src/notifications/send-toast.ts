// Posting a desktop toast — the write half of the notification surface the
// listener already reads. Item 11's "node-notifier" entry, delivered WITHOUT
// node-notifier: that package is stale (last real release years back, one
// command-injection CVE in its history) and bundles an unsigned SnoreToast.exe,
// while the WinRT surface it wraps is the one this package already vendors a
// PowerShell helper for. A second small helper beside the listener keeps the
// dependency count where it was.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const execFileAsync = promisify(execFile)
const helperDir = dirname(fileURLToPath(import.meta.url))
const TOAST_HELPER_PATH = join(helperDir, 'notify-toast.ps1')
const TOAST_TIMEOUT_MS = 10_000

/** Toast UI truncates around these anyway; the caps exist so a model cannot
 *  pump a whole page into the notification center. */
export const TOAST_TITLE_MAX_LENGTH = 120
export const TOAST_MESSAGE_MAX_LENGTH = 500

// Named, not inline — the invocation test asserts the command dereferences
// exactly these (the launch-app lesson: assert what is EXECUTED, not what is
// passed, or a dropped argument reports success for a day).
const TOAST_TITLE_VARIABLE = 'VYNEL_TOAST_TITLE'
const TOAST_BODY_VARIABLE = 'VYNEL_TOAST_BODY'

/** The exact PowerShell invocation, separated from the spawn so tests can
 *  assert it without posting anything. `-File` (not `-Command`) because the
 *  helper is a vendored script; the text still rides env vars so
 *  model-authored strings never touch the command line. */
export function buildToastInvocation(
  title: string,
  message: string,
): { args: string[]; env: Record<string, string> } {
  return {
    // `-ExecutionPolicy Bypass` exactly as the listener spawns ITS helper — a
    // default-policy box refuses `-File` outright without it (caught live on
    // the first smoke test, not in unit tests).
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TOAST_HELPER_PATH],
    env: { [TOAST_TITLE_VARIABLE]: title, [TOAST_BODY_VARIABLE]: message },
  }
}

/** Every toast title leads with this. The AUMID attribution reads "Windows
 *  PowerShell" — an OS-authority costume a model-authored toast must not wear:
 *  a prompt-injected background turn could otherwise toast "Windows: your
 *  session expired — sign in at …". The brand says who is actually talking. */
export const TOAST_TITLE_PREFIX = 'Vynel — '

export type SendDesktopToastInput = { title: string; message?: string }

/**
 * Post one toast. Throws with the REAL platform error on failure — a dead
 * per-user WpnUserService surfaces as 0x80040154 here exactly as it does on
 * the listener's poll, and the caller must say that rather than "sent".
 */
export async function sendDesktopToast(
  input: SendDesktopToastInput,
  deps: { run?: (args: string[], env: Record<string, string>) => Promise<void> } = {},
): Promise<void> {
  const title = input.title.trim()
  const message = input.message?.trim() ?? ''
  if (title.length === 0) {
    throw new Error('A toast needs a title.')
  }
  if (title.length > TOAST_TITLE_MAX_LENGTH || message.length > TOAST_MESSAGE_MAX_LENGTH) {
    throw new Error(
      `Toast text is too long — the title caps at ${TOAST_TITLE_MAX_LENGTH} characters and the ` +
        `message at ${TOAST_MESSAGE_MAX_LENGTH}. A notification is a headline; put detail in chat.`,
    )
  }
  const invocation = buildToastInvocation(`${TOAST_TITLE_PREFIX}${title}`, message)
  const run =
    deps.run ??
    (async (args: string[], env: Record<string, string>): Promise<void> => {
      if (process.platform !== 'win32') {
        throw new Error('Desktop notifications are supported on Windows only.')
      }
      await execFileAsync('powershell', args, {
        windowsHide: true,
        timeout: TOAST_TIMEOUT_MS,
        env: { ...process.env, ...env },
      })
    })
  await run(invocation.args, invocation.env)
}
