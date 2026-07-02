// `AiAgentProviderId` — the provider-id union. Sized for the full Phase 1→3
// set so consumers handle exhaustiveness from day one; Phase 1 registers
// `claude` only. See `docs/blueprints/providers/blueprint.md §7.1`.

export type AiAgentProviderId = 'claude' | 'codex' | 'gemini' | 'cursor'

// The provider id selected when no per-session override is supplied. Phase
// 1 has exactly one provider; consumers (chat / approvals routes) import
// this rather than redeclaring the literal locally — keeps the swap point
// for Phase 2 multi-provider in one place.
export const DEFAULT_PROVIDER_ID: AiAgentProviderId = 'claude'
