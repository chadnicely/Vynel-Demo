# instructions + notebook — editable guidance for root sessions (module notes)

**Chad's ask (2026-07-12):** an area to update the INSTRUCTIONS for the global/workspace root
sessions — like a notebook — so sessions know when to use which skill and how to communicate; plus
a notebook Claude itself consults for task playbooks. The example: a non-technical user wants to
build a web app — Claude should already hold the scaffold/roadmap/coding-discipline playbook and
apply it without the user knowing how to manage any of that.

**Status: PLANNED — not started.** Sequenced AFTER the session-tier extraction (landed 2026-07-12)
because the injection point lives in `@vynel/session`, and after cloud-admin-web (Chad's order).

## What already exists (build on, don't duplicate)

- **Hardcoded identity prompts:** `GLOBAL_ROOT_INSTRUCTIONS`
  (`packages/session/src/runtime/global-root-instructions.ts`) and `VYNEL_AGENT_INSTRUCTIONS`
  (`vynel-agent-instructions.ts`). These stay LOAD-BEARING and hardcoded (routing recipes the
  product depends on); user instructions are APPENDED, never replace them.
- **The memory `context` tag** (2026-07-11): `loadWorkspaceContextForSession` already injects
  context-tagged memory entries into turns. That's the proven injection pattern — but memory
  entries are fact-sized and agent-curated; instructions are document-sized and user-authored.
  Different primitive, same seam.
- **Per-feature prompt contributions:** `McpFeatureDescriptor.contributePrompt` +
  `composeSessionMcpServers` — the notebook's on-demand tools ride this exact mechanism.
- **Marketplace `rule` kind** (registry, unused so far) — the future distribution channel for
  curated playbooks.

## The two primitives (don't conflate them)

1. **Instructions (always-on):** short standing documents injected into EVERY turn of their scope.
   "Reply in plain language", "always confirm before sending email", "this workspace is a Nuxt 3
   shop — follow its conventions". Small, few, always present.
2. **Playbooks (the notebook, on-demand):** long task recipes (the web-app scaffold roadmap)
   retrieved BY THE MODEL when a matching task starts. Injecting them always would burn every
   turn's context on recipes that mostly don't apply — so the model gets list/read tools plus one
   standing line telling it to check the notebook before starting a project-type task.

## The shape

- **New leaf `packages/instructions`** (vertical slice: own schema + repos + ops + descriptor):
  one table `instruction_documents` — `id · userId · scope 'global'|'workspace' ·
  workspaceId (nullable loose-ref) · mode 'always'|'notebook' · title · body (markdown) ·
  enabled · sortOrder · timestamps`. One table because the two primitives differ in RETRIEVAL,
  not in shape; `mode` is the retrieval switch.
- **Injection (always-mode):** the session runtime's prompt composition (beside the capability +
  memory-context appends) loads enabled `always` docs for the turn's scope — global docs on
  global-root turns, global + that workspace's docs on workspace turns. Hard cap (chars) with a
  truncation warning surfaced in the UI, so a runaway document can't starve the turn.
- **Notebook access (notebook-mode):** a `vynel-notebook` `McpFeatureDescriptor` — `list_playbooks`
  (titles + one-liners) and `read_playbook`. `contributePrompt` contributes the one standing line:
  "before starting a multi-step project task, list the notebook — if a playbook matches, follow
  it." v1 tools are READ-ONLY; a `save_playbook` mutating tool (auto-cards) is a fork below.
- **UI:** a "Notebook" section (global menu + the workspace drawer, the sections-round pattern):
  two lists (Instructions / Playbooks), markdown editor, enable toggle, scope picker. Claude can
  DRAFT content in chat today with zero extra work — the user pastes it in.
- **API/SDK:** standard thin routes + `x-sdk-name` + `api:generate` (the faithful API-port recipe).

## Forks for Chad (answer before the build)

1. **Can the agent write to the notebook?** v1 recommended: UI-only writes (predictable, no
   surprise self-modification). Adding `save_playbook`/`update_instructions` as CARDED mutating
   tools later is additive.
2. **Seeded playbooks:** ship starter playbooks (web-app scaffold, "how to communicate with me")
   as bundled content, or leave the notebook empty and distribute curated ones later via the
   marketplace `rule` kind? Recommended: 2–3 bundled starters (the feature demos itself), rest via
   marketplace.
3. **Does `memory`'s `context` tag fold in later?** They overlap at the edges (both inject standing
   context). Keep separate for now — memory context is agent-saved facts, instructions are
   user-authored policy; revisit only if users confuse them.
