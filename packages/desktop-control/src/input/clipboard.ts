// The OS clipboard — read and write.
//
// WHY it earns a place: "copy from app A, paste into app B" is the single most
// common real task on a desktop, and doing it by re-typing through synthetic
// keystrokes is both slow and lossy (formatting, unicode, newlines that submit
// forms). Ctrl+C / Ctrl+V plus this pair is the reliable route.
//
// nut.js already ships a clipboard, so this adds NO dependency — it goes
// through the same single loader as every other input primitive.
//
// ⚠ PRIVACY — why reading is treated as an action, not a free read. The
// clipboard is global, not app-scoped, so a per-app rule would have nothing
// to check it against: a grant for Notepad says nothing about what the user
// last copied, which may be a password, a card number, or a one-time code they
// copied seconds ago from a password manager. It is therefore gated by the
// turn's PLAN envelope like any other action, and the tools are registered only
// when desktop actions are enabled. The plan card names it, so the user sees
// "read the clipboard" before it happens.

import { loadNutInput } from './nut-input-loader.js'
import { withTimeout } from '../a11y/xa11y-loader.js'

const CLIPBOARD_TIMEOUT_MS = 5000

/** Longest clipboard content handed back to the model. The clipboard can hold a
 *  whole document; a step's narration and the model's context should not. */
export const MAX_CLIPBOARD_READ_LENGTH = 8000

export interface ClipboardReadResult {
  text: string
  /** True when `text` was cut at MAX_CLIPBOARD_READ_LENGTH. */
  truncated: boolean
  /** Full length before truncation — so the model can say how much it did not see. */
  totalLength: number
}

/** Cut over-long content and SAY so. Silence would read as "that's all of it",
 *  which is how a model concludes it copied a whole document when it saw a
 *  prefix. Pure. */
export function truncateClipboardText(text: string): ClipboardReadResult {
  if (text.length <= MAX_CLIPBOARD_READ_LENGTH) {
    return { text, truncated: false, totalLength: text.length }
  }
  return {
    text: text.slice(0, MAX_CLIPBOARD_READ_LENGTH),
    truncated: true,
    totalLength: text.length,
  }
}

export async function readClipboard(): Promise<ClipboardReadResult> {
  const { clipboard } = loadNutInput()
  const content = await withTimeout(clipboard.getContent(), CLIPBOARD_TIMEOUT_MS, 'clipboard read')
  return truncateClipboardText(typeof content === 'string' ? content : String(content ?? ''))
}

export async function writeClipboard(text: string): Promise<void> {
  const { clipboard } = loadNutInput()
  await withTimeout(clipboard.setContent(text), CLIPBOARD_TIMEOUT_MS, 'clipboard write')
}
