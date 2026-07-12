import type { z } from 'zod'

// The Claude Agent SDK's `tool()` is overloaded; we widen at the call site so
// we don't bind to its exact generic shape. Structural twin of
// `@vynel/desktop-control`'s `mcp-tool-fn.ts` — deliberately duplicated: a
// sibling-leaf import is forbidden (invariant #2), and `@vynel/mcp-contract`
// stays free of tool-construction concerns.
export type McpToolFn = (
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
  }>,
  options?: {
    annotations?: {
      readOnlyHint?: boolean
      destructiveHint?: boolean
      idempotentHint?: boolean
      openWorldHint?: boolean
    }
  },
) => unknown
