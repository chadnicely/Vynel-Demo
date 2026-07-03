import type { z } from 'zod'

// The Claude Agent SDK's `tool()` is overloaded; we widen at the call site (the
// pattern @vynel/mcp's generated registry uses) so we don't bind to its exact
// generic shape. Shared by every desktop tool factory.
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
