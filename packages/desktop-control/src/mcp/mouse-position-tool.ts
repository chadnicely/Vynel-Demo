// `mouse_position` — where the pointer is right now.
//
// READ-ONLY: it moves nothing and needs no plan, so it sits with the looking
// tools. It reports in the SAME frame as `list_monitors`' bounds, which is what
// makes it useful — "the pointer is at -540,113" is directly comparable to a
// monitor rectangle, so it answers "which screen is the user actually on".

import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpToolFn } from '@vynel/mcp-contract'
import { readCursorPosition, type CursorPosition } from '../input/cursor-position.js'

const TOOL_DESCRIPTION =
  'Where the mouse pointer is right now, in the SAME coordinates list_monitors reports — so you can ' +
  'tell which screen the user is working on, or aim a gesture relative to where they already are. ' +
  'READ-ONLY: it moves nothing and needs no plan. A NEGATIVE x or y is valid, not an error — a ' +
  'monitor left of or above the main one has a negative origin. Windows only.'

export type MousePositionToolDeps = { read?: () => Promise<CursorPosition | null> }

/** Construct the read-only `mouse_position` SDK MCP tool. */
export function makeMousePositionTool(deps: MousePositionToolDeps = {}): unknown {
  const read = deps.read ?? (() => readCursorPosition())
  return (tool as unknown as McpToolFn)(
    'mouse_position',
    TOOL_DESCRIPTION,
    {},
    async () => {
      try {
        const position = await read()
        if (position === null) {
          // Say so rather than returning 0,0 — a position the model would aim
          // with must never be invented.
          return {
            content: [
              {
                type: 'text',
                text:
                  'Could not read the pointer position (Windows only, and the read can fail). Do ' +
                  'not assume a location — take coordinates from screenshot_app instead.',
              },
            ],
            isError: true,
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `The mouse pointer is at ${position.x}, ${position.y} (list_monitors coordinates).`,
            },
          ],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        }
      }
    },
    { annotations: { readOnlyHint: true } },
  )
}
