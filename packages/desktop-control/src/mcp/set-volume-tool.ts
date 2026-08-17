import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { McpToolFn } from '@vynel/mcp-contract'
import { setSystemVolume } from '../system/volume.js'
import type { DesktopPlanEnvelope } from '../plan/desktop-plan-envelope.js'
import { unattendedRefusalError } from '../plan/plan-gated-authorization.js'
import { recordFailedAct } from '../plan/record-failed-act.js'

// The clipboard's gate, for the clipboard's reason: the volume belongs to the
// whole COMPUTER, not to any app, so there is no resolved app name to
// authorize and `isArmed()` alone would be self-granted authority.
// `unattendedRefusalError` requires real consent and refuses display-only.

const TOOL_DESCRIPTION =
  "Change the computer's master volume or mute state. Pass `level` (0-100), `mute` (true/false), " +
  'or both; at least one is required. Requires an approved plan this turn — name the volume change ' +
  'in a step. Returns the level and mute state the audio device REPORTS afterwards, so the answer ' +
  'is verified, not assumed. Muting is the polite move for "silence it" — it preserves the ' +
  "user's chosen level for when they unmute. Windows only."

export type SetVolumeToolDeps = {
  set?: typeof setSystemVolume
}

/** Construct the `set_volume` SDK MCP tool (mutating — destructiveHint).
 *  Consent-gated by construction, exactly like the clipboard tools. */
export function makeSetVolumeTool(envelope: DesktopPlanEnvelope, deps: SetVolumeToolDeps = {}): unknown {
  const set = deps.set ?? setSystemVolume
  return (tool as unknown as McpToolFn)(
    'set_volume',
    TOOL_DESCRIPTION,
    {
      level: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe('The master volume as a percentage, 0-100.'),
      mute: z.boolean().optional().describe('true to mute, false to unmute.'),
    },
    async (args: Record<string, unknown>) => {
      const planRefusal = unattendedRefusalError(envelope)
      if (planRefusal !== null) {
        return { content: [{ type: 'text', text: planRefusal }], isError: true }
      }
      const level = typeof args['level'] === 'number' ? args['level'] : undefined
      const mute = typeof args['mute'] === 'boolean' ? args['mute'] : undefined
      if (level === undefined && mute === undefined) {
        return {
          content: [
            { type: 'text', text: 'Pass `level` (0-100), `mute` (true/false), or both — neither given.' },
          ],
          isError: true,
        }
      }
      const asked = [
        ...(level !== undefined ? [`level ${level}%`] : []),
        ...(mute !== undefined ? [mute ? 'mute' : 'unmute'] : []),
      ].join(' + ')
      try {
        const state = await set({
          ...(level !== undefined ? { level } : {}),
          ...(mute !== undefined ? { mute } : {}),
        })
        // 'ok' is honest here, unlike most acts: the state comes from reading
        // the device back, not from the request having been sent.
        envelope.recordAct({
          tool: 'set_volume',
          appName: null,
          detail: `volume ${asked}`,
          outcome: 'ok',
          note: `now ${state.level}%${state.muted ? ', muted' : ''}`,
        })
        return {
          content: [
            {
              type: 'text',
              text:
                `The device now reports ${state.level}% volume, ${state.muted ? 'MUTED' : 'not muted'}.` +
                (level !== undefined && state.level !== level
                  ? ` (Asked for ${level}% — the device landed on ${state.level}%, its nearest step.)`
                  : ''),
            },
          ],
        }
      } catch (err) {
        recordFailedAct(envelope, { tool: 'set_volume', appName: null, detail: `volume ${asked}` }, err)
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { destructiveHint: true } },
  )
}
