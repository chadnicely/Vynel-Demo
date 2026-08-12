// The clipboard pair — the reliable route for "copy this from here, put it in
// there", which re-typing through synthetic keystrokes does badly (slow, and it
// mangles formatting, unicode, and newlines that submit forms).
//
// BOTH are gated the same way, including the READ. The clipboard is global
// rather than app-scoped, so a per-app rule would have nothing to check it
// against — a grant for Notepad says nothing about the password the user copied
// out of their password manager ten seconds ago.
//
// That absence is why the gate is `unattendedRefusalError`, NOT the plain
// `planRequiredError` the app-directed act tools use: with no app there is no
// second door, so `isArmed()` alone would be the whole authorization — and the
// model arms the envelope itself (propose_desktop_plan cards in ask mode only).
// An unattended turn would have opened the clipboard with no card, no grant,
// and nobody at the machine to see the overlay say so. So these additionally
// require the envelope to carry real consent; under `display-only` they refuse.
// (They also register only when desktop actions are enabled.)

import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from './mcp-tool-fn.js'
import { readClipboard, writeClipboard } from '../input/clipboard.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { unattendedRefusalError } from '../plan/plan-gated-authorization.js'

const READ_DESCRIPTION =
  'Read the text currently on the system clipboard. Requires a plan (propose_desktop_plan). ' +
  'Use it after copying something (ctrl+c) to get the exact text — far more reliable than reading ' +
  'it off a screenshot. The clipboard is shared by the whole computer, so it may hold something ' +
  'private the user copied earlier: if what comes back looks like a password, card number or ' +
  'one-time code, do NOT repeat it back or type it anywhere — say you found credentials and stop. ' +
  'Long content is truncated. Windows only.'

const WRITE_DESCRIPTION =
  'Put text on the system clipboard so it can be pasted (ctrl+v). Requires a plan ' +
  '(propose_desktop_plan). Prefer this + ctrl+v over typing long or formatted text: typing is slow ' +
  'and a stray newline can submit a form. Replaces whatever the user had copied — if that matters, ' +
  'read it first and put it back. Windows only.'

export function makeReadClipboardTool(envelope: DesktopPlanEnvelope): unknown {
  return (tool as unknown as McpToolFn)(
    'read_clipboard',
    READ_DESCRIPTION,
    {},
    async () => {
      const planRefusal = unattendedRefusalError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      try {
        const result = await readClipboard()
        // Recorded — and the LENGTH only, never the text. An access log whose
        // purpose is "show the user what Claude did" cannot omit "read your
        // clipboard": this tool's own description warns it may surface a
        // password, which makes it the entry that matters most and the one
        // whose content must never be stored.
        envelope.recordAct({
          tool: 'read_clipboard',
          detail: `read the clipboard (${result.totalLength} characters)`,
          outcome: 'ok',
        })
        if (result.totalLength === 0) {
          return { content: [{ type: 'text', text: 'The clipboard is empty.' }] }
        }
        const note = result.truncated
          ? `\n\n[Truncated: showing the first ${result.text.length} of ${result.totalLength} characters.]`
          : ''
        return { content: [{ type: 'text', text: `${result.text}${note}` }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    // Deliberately NOT readOnlyHint — it reads global state that may be
    // private, so it is not "read-only" in the sense that matters. The real
    // gate is `unattendedRefusalError` above; the annotation only speaks to
    // generic MCP clients (Vynel's own approval path is name-list driven).
    { annotations: { destructiveHint: false } },
  )
}

export function makeWriteClipboardTool(envelope: DesktopPlanEnvelope): unknown {
  return (tool as unknown as McpToolFn)(
    'write_clipboard',
    WRITE_DESCRIPTION,
    {
      text: z.string().describe('The text to place on the clipboard.'),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = unattendedRefusalError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      const text = typeof args['text'] === 'string' ? args['text'] : null
      if (text === null) {
        return {
          content: [{ type: 'text', text: 'A "text" string is required.' }],
          isError: true,
        }
      }
      try {
        await writeClipboard(text)
        // Length only. A write REPLACES global machine state, so it belongs in
        // the record; what was written does not.
        envelope.recordAct({
          tool: 'write_clipboard',
          detail: `replaced the clipboard (${text.length} characters)`,
          outcome: 'ok',
        })
        return {
          content: [{ type: 'text', text: `Copied ${text.length} characters to the clipboard.` }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { destructiveHint: true } },
  )
}
