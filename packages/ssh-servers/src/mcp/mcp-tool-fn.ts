import type { z } from 'zod'

// The Claude Agent SDK's `tool()` is overloaded; we widen at the call site so
// we don't bind to its exact generic shape. Structural twin of the
// instructions/asks copies — deliberately duplicated (sibling-leaf imports are
// forbidden; a third copy is the signal to promote this to @vynel/mcp-contract,
// noted in the asks review).
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
