// The SOLE import site for `@anthropic-ai/claude-agent-sdk` in `@vynel/providers`
// — the anti-corruption base. Every file under `claude/` reaches the runtime
// (`query`) and the SDK's types (`SDKMessage`, `Options`, `HookCallback`,
// `CanUseTool`) through HERE, never from the SDK package directly.
//
// `@vynel/providers` is a widely-consumed foundation whose public `shared/`
// contract is SDK-free; this module is the single choke point where an Anthropic
// changelog change lands, so SDK drift never ripples past it into the ~22
// `claude/internal/*` helpers or into any downstream package. When the SDK bumps,
// reconcile it in this one file. See `docs/module-notes/providers.md` → "the BASE".
//
// (`*.test.ts` files intentionally `vi.mock('@anthropic-ai/claude-agent-sdk')` at
// the real module boundary — the mock flows through this re-export unchanged.)

export { query } from '@anthropic-ai/claude-agent-sdk'
export type {
  CanUseTool,
  HookCallback,
  ModelInfo,
  Options,
  SDKMessage,
  // Streaming-input mode's message type — model discovery opens a query whose
  // input never yields one (the handshake is all it wants).
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
