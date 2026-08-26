// Open the operating system's own choose-a-folder window and return what the
// user picked. Backs the ONE Browse button on "a project you already have"
// (Chad, 2026-08-24) — non-technical people know this dialog from every other
// program they use, which is the whole reason to reach for it instead of an
// in-app tree. (The in-app `FileSystemBrowser` stays for the other pickers.)
//
// The engine runs on the user's machine, so the dialog appears on their own
// screen. Cancelling is a NORMAL answer (null), never an error — and so is a
// platform we cannot open a dialog on, because the caller's fallback is simply
// to keep asking in its own UI.
//
// SHAPE: fixed argument lists via execFile, mirroring read-git-facts — no
// prompt string can ever be interpreted as a command. Windows runs the
// embedded picker script as `-EncodedCommand` (nothing on disk, nothing to
// quote).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  WINDOWS_FOLDER_PICKER_SCRIPT,
  encodePowerShellCommand,
} from './windows-folder-picker-script.js'

const run = promisify(execFile)

/** The user may sit in the dialog as long as they like — within reason. */
const DIALOG_TIMEOUT_MS = 10 * 60_000

export type PickerCommand = { file: string; args: string[] }

export type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string }>

const defaultRunner: CommandRunner = async (file, args) => {
  const { stdout } = await run(file, args, { timeout: DIALOG_TIMEOUT_MS })
  return { stdout }
}

/** The native picker for a platform, or null where none can be opened. */
export function buildPickerCommand(platform: NodeJS.Platform): PickerCommand | null {
  switch (platform) {
    case 'win32':
      // -STA: IFileOpenDialog is COM UI and refuses PowerShell's default
      // multi-threaded apartment. -ExecutionPolicy Bypass: the script must run
      // regardless of the machine's policy.
      return {
        file: 'powershell.exe',
        args: [
          '-NoProfile',
          '-STA',
          '-WindowStyle',
          'Hidden',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encodePowerShellCommand(WINDOWS_FOLDER_PICKER_SCRIPT),
        ],
      }
    case 'darwin':
      return {
        file: 'osascript',
        args: [
          '-e',
          'POSIX path of (choose folder with prompt "Choose the folder your projects live in")',
        ],
      }
    case 'linux':
      return { file: 'zenity', args: ['--file-selection', '--directory'] }
    default:
      return null
  }
}

/** Null = the user cancelled, or this platform has no dialog to offer. */
export async function pickFolderWithNativeDialog(
  runCommand: CommandRunner = defaultRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const command = buildPickerCommand(platform)
  if (command === null) return null
  try {
    const { stdout } = await runCommand(command.file, command.args)
    const picked = stdout.trim()
    return picked === '' ? null : picked
  } catch {
    // Not a swallowed failure but the dialogs' own protocol: osascript and
    // zenity report cancel as a non-zero exit, and a missing binary means the
    // same thing to the caller — no folder was chosen.
    return null
  }
}
