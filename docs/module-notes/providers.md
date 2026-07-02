# Provider pull — `@vynel/providers` (the AI seam) — SCOPING ANCHOR

**Status: NOT STARTED.** This is the mission's next module (after knowledge ✅ + workspace ✅). Big +
sensitive — the AI seam. **Step-by-step WITH Chad.** Scope first, get Chad's okay, THEN pull.

## Chad's standing directive (verbatim intent)
> Check **ALL** the old provider functions against the **latest** `@anthropic-ai/claude-agent-sdk`. Cover
> **all** available SDK functions (drop none) so they're usable as needed. Faithful pull → green → fold.

So the pull is NOT just a faithful move — it's a faithful move + an **SDK-capability audit**: enumerate the
old provider's functions, enumerate the current SDK surface, and make sure nothing usable is dropped.

## The AI-seam invariant (CLAUDE.md — do NOT violate)
- The `claude-agent-sdk` **runtime** (`query`, the session loop) may be imported **only** inside
  `packages/providers/src/claude/`. Everything else reaches it **only through `AiAgentProvider`**.
- The SDK's **builder** exports (`tool`, `createSdkMcpServer`, `SdkMcpToolDefinition`) carry no runtime and
  are already permitted in the MCP layer (`apps/mcp`) — that boundary is settled.
- Provider is neither a clean leaf nor a hub: the `provider_preferences` **schema stays in the kernel**
  (`@vynel/db/schema/providers`); `@vynel/providers` holds the runtime + logic (the `AiAgentProvider`
  contract + the claude implementation). Confirm the exact split during scoping.

## What this pull unblocks (why it's the natural next step)
The **③ agent-turn MCP binding + the approval CARD** were deferred to "the providers/composer phase" all
session (knowledge Stage-2 shipped its mutating MCP tools in *auto mode, no card* pending this). The
provider layer is the prerequisite for:
- `packages/mcp-contract` + `apps/mcp/build-in-process-server.ts` (`createSdkMcpServer`, in-process) +
  the `McpFeatureDescriptor` wrappers → wired into the api turn composer (`composeSessionMcpServers`).
- The real approval card ("we will have the approval improved" — Chad).
(See STATE.md "The 3 MCP directions" + "NEXT: providers/composer move".)

## Source (READ-ONLY reference)
Old repo `E:\KAFI\WORKSPACE\v2\vynel`, branch `refactor/session-library` (tip `754615f`). The provider
code lives there (confirm exact paths — likely `packages/providers` or a `core/providers` slice). Pull via
`git -C /e/KAFI/WORKSPACE/v2/vynel archive refactor/session-library <paths> | tar -x -C /e/KLONE/Workspace/vynel`.

## The per-module loop for this pull
1. **Scope** → fill this doc: enumerate old provider functions + the current SDK surface (the audit), the
   `AiAgentProvider` contract, what's schema (kernel) vs runtime/logic (package), the known old-repo gaps.
2. **Outline the plan → get Chad's okay** (big change; his rule). Flag every real fork.
3. **Faithful pull → green** (gate = `pnpm test`), **then** fold/improve. Runtime ONLY in `providers/src/claude/`.
4. `code-reviewer` on the diff + green gate → prompt Chad to commit (conventional; NO AI identity).

## Watch-outs
- Latest SDK models to default to: **Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5** (see the harness model note) —
  the audit should not hard-code an old model list.
- Agents stall on long runs (>~9 min) here — keep agent tasks small or do it directly.
- When touching anything Claude/Anthropic-SDK-shaped, the `claude-api` skill is the source of truth — load it.
