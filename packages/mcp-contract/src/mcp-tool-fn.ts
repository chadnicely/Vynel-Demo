// The Claude Agent SDK's `tool()` is overloaded; every MCP-tool producer
// widens it at the call site (`(tool as unknown as McpToolFn)(…)`) so no
// package binds to the SDK's exact generic shape. ONE home for that widening
// (it used to be a structural twin copied into six packages) — the contract
// package already carries the SDK builder types, and `zod` here is type-only.

import type { z } from 'zod'

/** One block of a tool result — text, or an image the SDK forwards inline. */
export type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

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
