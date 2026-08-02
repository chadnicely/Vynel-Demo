# chat-mentions — @ agents/personas · "/" skills+commands · "#" workspace study

Task 3 of the 2026-08-02 five-task session. Chat-input superpowers in every chat surface
(Global root chat, workspace chat, spawned-session threads): `@` dispatches background
runs whose reports land back in the originating chat, `/` inserts slash-native prompts,
`#` grants per-message read-only study access to referenced workspaces.

## The grammar (ONE home: `packages/contracts/src/chat/composer-tokens.ts`)

| Token | Form | Boundary | Emits (with offsets) |
| --- | --- | --- | --- |
| agent | `@code-reviewer` (kebab) | start-of-text or whitespace | `mentions[]` (one list for agents+personas) |
| persona | `@Sarah` (Capitalized manager name) | same | `mentions[]` — resolution disambiguates |
| workspace | `#vynel` (simple: `[A-Za-z0-9][A-Za-z0-9._-]*`) or `#"Q3 plans"` (quoted, no `"`/newline) | same | `workspaceRefs[]` |
| slash | `/deploy`, `/git:commit` (namespaced) | message START only (leading whitespace ok) | `slashCommand` (max one) |

`parseComposerTokens(text)` returns every occurrence with `{start, end}` offsets. The
format helpers (`formatAgentMentionToken` / `formatPersonaMentionToken` /
`formatWorkspaceRefToken` (auto-quotes) / `formatSlashCommandToken`) are the inverse —
what the picker inserts is exactly what both ends parse. Emails (`a@b.com`), `issue#42`,
markdown headings, and mid-message slashes never tokenize.

**Server re-parse is the source of truth.** Zero wire changes: the tokens travel inside
`userMessageText` verbatim; the server re-parses and resolves against real rows. We
deliberately did NOT add the optional parsed-hint fields to the turn schemas — an
unread wire field is dishonest surface (decision, not omission).

## Resolution (`packages/orchestration/src/agents/resolve-mentions.ts`, rewired)

- Agents by slug via `listAgentsForWorkspace` (workspace ∪ user; null = user-only —
  the global root works now; the old non-null signature was widened honestly).
- Personas by CASE-SENSITIVE match on the RESOLVED manager name (explicit or derived
  default). `deriveDefaultManagerName`/`resolveManagerName` MOVED to
  `@vynel/contracts/workspaces/manager-name` (pure, bundle-safe — the client roster
  derives the same names; `@vynel/workspaces` re-exports).
- Workspace refs by case-insensitive exact name match; workspaces read via the KERNEL
  repo (`@vynel/db/repositories/workspaces`) — no sibling-leaf import.
- Collisions: agent slug wins over persona (settled rule); duplicate names/refs resolve
  to the MOST RECENTLY ACCESSED workspace (repo order — deterministic + explainable).
- Unmatched tokens are just text (standing posture). `parseMentionSlugs` deleted —
  one grammar.

## @ dispatch — how the report reaches the originating chat

`apps/local-api/src/sessions/composer-mention-turn.ts` (`prepareComposerMentionTurn`)
is the one home all three streams call. It never throws (mention machinery must never
break a turn), filters SELF-references (own persona / own #), and defers enqueueing
until the turn's session id resolves (the job's provenance edge = the very turn that
carried the mention; wired via the streams' existing session-created /
user-message-persisted taps).

- **@agent → `delegation_jobs` kind `'agent-run'`** (new): the tick branch
  (`packages/session/src/delegation/run-agent-run-job.ts`) runs the agent as a FRESH
  leaf via `delegateToLeafSession` (recorded hidden `scope:'agent'` segment; safety
  posture fixed: `bypass-with-behavior-gate` + carded tools fail-closed DENIED — a
  leaf never inherits the turn's mode; it takes the turn's model only). Completion
  CO-COMMITS (invariant 5) complete + surfaced-mark + `enqueueReportDelivery` to the
  originating chat — deterministic delivery is honest here because a leaf's
  `resultText` IS its designed return value (no send_message exists in a leaf; this is
  not the no-harvest case). Pool key = the JOB id, AND the claim query exempts
  agent-run rows from the workspace exclusion (a leaf resumes no conversation — it
  must never hold NOR WAIT ON the workspace single-writer slot; without the claim
  exemption a 600s task delegation would starve a pending mention run). The
  retry-backoff gate still applies.
- **@persona → `enqueueWorkspaceDelegation`** to that workspace (the normal routed
  turn; no-harvest preserved — the workspace reports via send_message per its steer).
  NEW `requesterWorkspaceId` column (loose ref: "where this job's reports land";
  null = global root = pre-mentions behavior byte-for-byte). The delegated-turn MCP
  composer stamps it as the ambient `x-vynel-report-requester` header
  (`report-requester-header.ts`, the report-caller shape); `dispatchReportToRequester`
  honors it for workspace-primary callers (ownership-checked; foreign/gone/SELF
  overrides fall back to the global root). The give-up failure push
  (`settle-failed-delegation-attempt.ts`, extracted from the tick) honors it too.
- The current turn gets a system-note (via the systemPromptAppend seam) naming what
  was dispatched, so the model neither duplicates nor re-delegates the work.
- Reports render through the EXISTING notify-turn machinery (attributed inbound + the
  report-message marker) — zero UI changes needed for the report box.

## # study descriptor (`packages/workspaces/src/mcp/`, `@vynel/workspaces/mcp` subpath)

`buildWorkspaceStudyDescriptor({ workspaces })` — a per-turn FACTORY (ssh/asks
precedent) over EXACTLY the #-mentioned workspaces resolved this turn. Server
`vynel-workspace-study`, `mutatingToolNames: []`, three read-only tools:

- `get_workspace_overview` — name/manager/path/top-level entries.
- `list_workspace_files` — bounded recursive tree (depth ≤ 6, ≤ 400 entries,
  dependency/build dirs skipped, symlinked dirs never descended).
- `read_workspace_file` — contained to the workspace root (absolute/`..`/null-byte
  rejected BEFORE disk; realpath re-check defeats symlink escapes — the Task-1
  lesson), 256 KB cap, binary refusal.

Id-gated per call (`resolveStudyWorkspace` — unknown ids get an actionable error
naming the legal set). Per-message by construction: composed only for turns whose
message carried refs; the contributed prompt says the tools vanish on later messages
(pre-empting the deferred-tool "server disconnected" narrative). Logic lives in
`workspace-study-tools.ts` (directly tested); the descriptor is a thin wrapper.
Composed into all three streams; the spawned-thread stream merges it over its
background set via `mergeComposedSessionMcpServers` (new, in
`compose-session-mcp-servers.ts`).

## "/" — client-only

Commands insert `/name ` verbatim (slash-native; the runtime accepts slash prompts —
the `/context` precedent). Skills are NOT slash-native → picking one inserts
`Use the <skillId> skill: ` (the brief's honest fallback). No server change.

## UI (packages/ui data-blind; apps/local-web wires data)

- `lib/composer-trigger.ts` — PURE live-trigger detection at the caret (`@`/`#`
  word-boundary anywhere, `/` at start only; the open `#"…` form keeps the picker
  alive across spaces) + `applyComposerSuggestion` (token replacement + caret).
- `lib/textarea-caret.ts` — mirror-div caret x (best-effort; zeros in jsdom).
- `lib/use-composer-suggest.ts` — the picker state machine: bare trigger pops the
  menu immediately (Chad's rule), typing filters (prefix-on-token first), Up/Down +
  Enter/Tab/click pick, Escape dismisses that token's menu. `MAX_VISIBLE_ITEMS` 24.
- `components/InlineSuggestMenu.vue` — presentational, caret-anchored above the
  input, group labels (CommandPalette shape); textarea keeps focus (combobox).
- `ChatComposer.vue` — three new roster props (`mentionSuggestions` /
  `workspaceSuggestions` / `slashSuggestions`), menu wiring; Enter picks, never
  sends, while open. Absent rosters = pickers off (other consumers unaffected).
- `AppComposer.vue` — new `scope` prop (SectionScope; defaults global); rosters
  built by PURE `composer-suggestion-rosters.ts` from `useAgents` /
  `useWorkspaceList` / `useInstalledSkills` (healthy only) / `useCommands` (Task 2's
  reader). Self-workspace excluded from personas + #. Hosts: GlobalChatView
  (default), WorkspaceView (`scope`), SessionThreadView (session's grounding).
- **Round-trip honesty guard** (review fix): the roster builders OFFER only tokens
  that parse back to the exact stored name (`parseComposerTokens(insert)` — the
  server's match). A renamed manager like "Mary Jane" or a workspace name with
  embedded quotes/newlines can never resolve, so those rows are dropped, never
  offered as dead tokens.
- **IME guard** (review fix): `isComposing`/keyCode-229 keydowns pass through both
  the picker interceptor AND the Enter-to-send path (the send path had the same
  pre-existing bug class).

## Deferred (deliberate)

- **Spawned-thread report landing**: mentions typed in a spawned-session thread
  dispatch fine, but reports land at the session's GROUNDING (workspace primary /
  global root) — report-delivery to spawned sessions would break the "spawned
  sessions are leaves, they never receive deliveries" row invariant. Revisit only
  with Chad.
- **Stop-mid-run for agent leaves**: the stop bridge flags an agent-run (report
  suppressed at terminal time) but cannot interrupt the leaf mid-run —
  `delegateToLeafSession` exposes no onSessionResolved seam yet.
- **`McpToolFn` promotion**: now FIVE structural copies (asks / desktop-control /
  instructions / ssh / workspaces). Two copies record "deliberately duplicated;
  mcp-contract stays free of tool construction", ssh records "third copy = promote".
  Conflicting recorded stances — Chad's call, not settled unilaterally here.
- **Persona ambiguity UX**: two workspaces sharing a manager name resolve to the
  most-recently-accessed; the picker could disambiguate visually (it shows
  "Sarah · Acme") but the token carries only the name.
- **Parsed-hints wire fields**: skipped (server re-parse is authoritative; unread
  fields are dishonest surface). Add only if a real consumer appears.
- **Highlight styling of tokens in the textarea**: plain text in v1 (no rich-text
  editor — per the brief).
- ChatComposer.vue is ~615 lines (pre-existing 540 + minimal wiring); the machinery
  was extracted to lib/ — a further split (attachments composable) is a clean next cut.

## Reviewer-scrutiny list

(First-pass review returned 0 must-fix / 3 should-fix — all three applied: the
claim-query agent-run exemption, the IME guards, the roster round-trip filter.)

- `run-agent-run-job.ts` completion co-commit (complete + surfaced + delivery in one
  tx) and its interplay with the tick's claim/exclusion keys.
- `dispatchReportToRequester` override path: self/foreign fallbacks, `deliveredTo`
  labeling (destination vs reporter).
- Study-tool path guard on Windows (case-insensitivity of `startsWith` prefixes is
  NOT handled — drive-letter case differences could false-negative; realpath
  normalizes in practice; comparisons derive from one root string, so consistent).
- The report card renders `sourceLabel` = bare agent name (no " · " segment) — the
  persona-first label parsing note says the UI takes the LAST segment; verify the
  card renders single-segment labels cleanly.
