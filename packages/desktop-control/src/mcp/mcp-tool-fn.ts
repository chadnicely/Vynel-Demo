import type { z } from 'zod'

// One MCP content block — text for the tree/list tools, image for screenshots.
export type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

// The Claude Agent SDK's `tool()` is overloaded; we widen at the call site (the
// pattern @vynel/mcp's generated registry uses) so we don't bind to its exact
// generic shape. Shared by every desktop tool factory.
export type McpToolFn = (
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: Record<string, unknown>) => Promise<{
    content: McpToolContent[]
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
