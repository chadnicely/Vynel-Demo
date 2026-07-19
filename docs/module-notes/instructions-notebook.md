# instructions + notebook — editable guidance for root sessions (module notes)

**Chad's ask (2026-07-12):** an area to update the INSTRUCTIONS for the global/workspace root
sessions — like a notebook — so sessions know when to use which skill and how to communicate; plus
a notebook Claude itself consults for task playbooks. The example: a non-technical user wants to
build a web app — Claude should already hold the scaffold/roadmap/coding-discipline playbook and
apply it without the user knowing how to manage any of that.

**Status: PLANNED — not started.** Sequenced AFTER the session-tier extraction (landed 2026-07-12)
because the injection point lives in `@vynel/session`, and after cloud-admin-web (Chad's order).

## What already exists (build on, don't duplicate)

- **Editable identity prompts** (moved 2026-07-20 out of TS string literals): the always-on
  session-identity prompts — `global-root`, `workspace-agent`, `voice-turn` — now live as editable
  markdown in `packages/instructions/session-instructions/`, loaded via the SDK-free
  `@vynel/instructions/session-instructions` subpath (the whole file is the prompt). They stay
  LOAD-BEARING (routing recipes the product depends on — the colocated loader test guards the
  routing-tool names); a user's own instructions are APPENDED, never replace them. This is the first
  concrete step of the deferred always-on-instructions arc — content editability, before DB/UI.
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

## ✅ Forks SETTLED (Chad, 2026-07-12)

1. **Claude is READ-ONLY on the notebook** ("claude can make mistakes"): tools = list + read only.
   SYSTEM (verified) notebooks are immutable everywhere — shipped by the team, never editable in
   the UI either. USERS create and update their OWN documents via the UI. No agent-write tools,
   not even carded ones, in v1.
2. **No marketplace distribution now** (add as a category later). Verified notebooks ship from a
   REPO DIRECTORY the team drops files into: `packages/instructions/notebooks/*.md` with
   frontmatter (id/title/one-liner) — loaded at boot like the VERIFIED_SKILL_CATALOG precedent,
   surfaced read-only alongside the user's DB-backed documents.
3. **Memory context stays separate** (explained to Chad): memory = Claude-authored FACTS,
   self-curated; notebook/instructions = human-authored POLICY, Claude read-only. Prompt
   composition trust order: identity prompts → verified notebooks/instructions → user instructions
   → memory context — policy outranks recollection, and the split makes the write-permission model
   structural.

## ⚠ SCOPE CORRECTION (Chad, 2026-07-12, mid-build)

**"Notebooks are BOOKS, not memory."** On-demand reference/helper material Claude opens when a task
calls for it — curated by the team to carry CURRENT best-practice guidance ("research with latest
data"). Never injected wholesale into prompts. **The always-on INSTRUCTIONS half is DEFERRED
entirely** ("we will implement all in instructions later"): this slice touches `packages/session`
NOT AT ALL — no injection, no trust-order composition, no cap. The schema keeps the
`mode 'always'|'notebook'` column (reserved, WHY-commented) so the instructions arc needs no
migration, but every op/list in v1 is notebook-mode only. The trust-order design above stays the
plan of record FOR THAT LATER ARC.
