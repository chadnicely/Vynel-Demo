import type { z } from 'zod'

// The Claude Agent SDK's `tool()` is overloaded; we widen at the call site so
// we don't bind to its exact generic shape. Structural twin of
// `@vynel/instructions`' / `@vynel/asks`' `mcp-tool-fn.ts` — deliberately kept
// internal to each producer (`@vynel/mcp-contract` stays free of
// tool-construction concerns); hoisting the twin into the contract is a
// recorded deferred-improve.
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
