import type { z } from 'zod'

// The Claude Agent SDK's `tool()` is overloaded; we widen at the call site so
// we don't bind to its exact generic shape. Structural twin of the
// instructions/asks/ssh copies — deliberately duplicated (sibling-leaf imports
// are forbidden, invariant #2). NOW FIVE copies: promoting this to
// `@vynel/mcp-contract` is overdue but contested (the asks copy records
// "mcp-contract stays free of tool-construction concerns") — flagged for Chad
// in docs/module-notes/chat-mentions.md rather than settled unilaterally here.
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
