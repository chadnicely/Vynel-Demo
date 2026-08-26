# 2026-08-26 — Session/workspace state fixes (Kafi's five-screenshot list)

Kafi's list, worked on `fix/session-state` (worktree, band 18960): the Global row's missing idle
mark · a workspace reading idle while its child session works · delivered-session rows wearing
two-letter initials · agent cards that don't open · paths and screenshots that aren't clickable
or visible.

## What landed

1. **Global row state mark.** The tree row's state cluster (spinner / needs-input · problem ·
   completed dot / parked play glyph) became ONE component, `TreeStateMark.vue`; the pinned
   Global row wears it too. Before, Global drew only the spinner and the needs-input dot.
2. **Root cause of "idle while a child works" — the wire, on BOTH doors.** `run-task-job.ts`
   announced every SESSION-target delegated turn as `scopeKind:'global'`, even for a child
   spawned inside a room; the interactive door (`session-turn.ts`) did the same for a spawned
   child (only an agent colleague announced in its room). TasksPanel had documented the mismatch
   and worked around it by resolving turns through the overview. The runner now resolves the
   target FIRST and announces under its grounding workspace (the `run-agent-run-job` shape,
   announce inside the try, `announcedTurn` ended in catch/finally), and the interactive door
   announces by `spawned.workspaceId` alone — both still name their own `primarySessionId`, so
   `matchTurnToIdentity(workspace)` never mistakes a child for the room's thread. Every workspace
   indicator (tree, tab strip, sidebar card, nodes, rail) already read the one home
   `useWorkspaceStatuses` — nothing on the web side needed a new ladder. (The reviewer caught
   the second door: I had read only the `workspace` half of its condition.)
3. **Session icons on delivered rows + engine kinds.** A delivered row names its author by label
   only, so the host resolves the name against the sessions overview (`useSessionIconsByName`,
   room-scoped; the global surface hears every room's children) and hands `MessageRow` a raw
   glyph component in `authorPersona.glyph`. The engine's own reporter labels (`Background task`,
   `Tasks`, `Schedule ·`, `Monitor ·`) moved into ONE contract
   (`contracts/chat/engine-reporter-labels.ts`) with `engineReporterKindOf`; the web maps each
   kind to a glyph with a default fallback, and a system notice's card wears it instead of the
   bell.
4. **Agent runs.** `session-created` only announces a NEW segment, so on a continuing
   conversation the live pointer's host was null and the click a quiet no-op —
   `liveTurnHostSessionId` now falls back to the persisted user row (and a landed swap). The
   pointer IS the card: the generic Agent tool chip is filtered out of both hosts' batches (and
   out of the reply-fold test), and `AgentRunPane` shows the instruction (description · agent
   type · brief) above the activity and the settled result below it.
5. **Clickable paths + pictures.** `vynel://file/<encoded path>` is the one grammar (ui
   `lib/file-link.ts`): the tool chip's file name, the expanded path header, and paths found in
   chat markdown (prose + inline code, never inside a URL or a `<pre>`) all link; the shell's
   link router resolves a path to the room whose folder holds it (deepest wins; relative paths
   land in the room on screen) and opens the editor. A tool result carrying an image block
   (screenshot_app, `observe`, an image Read — both MCP and API block grammars) renders as the
   picture: small on the chip, full with its caption expanded.

## Learnings worth keeping

- **Two doors into one child must announce the same scope.** The overview-resolution workaround in
  TasksPanel was right for its surface but left every scope-keyed reader (the room ladder) wrong.
  When the wire is the inconsistency, fix the producer — every reader is then right by
  construction, and the workaround simply stops being load-bearing.
- **The announce-after-resolve shape is the general one.** A frame's grounding is only known
  after the target resolves; announcing early with a guess leaks a wrong scope for the whole turn.
  The zombie-turn doctrine still holds with a hoisted nullable handle.
- **A glyph is a Component the host resolves; `@vynel/ui` stays icon-library-free.** Pass the
  component (marked raw — Vue warns when a component object turns reactive inside a prop object),
  never an icon name the package would have to map.
- **The hardest part of "clickable paths" is the false positive.** The path grammar requires a
  directory, a letter-first extension, Unicode-aware word boundaries (a `@scope/pkg` specifier
  and a sentence-ending `.` are not part of a path), forward slashes for a RELATIVE hit (a spaced
  Windows path must never yield its tail as a room-relative link), and a non-URL context; the
  router refuses anything no room's folder holds. A dead link is worse than no link — the
  reviewer's probes (`src/pricing.ts.`, `C:\Program Files\App\config.json`, `docs/plán/notes.md`)
  are now pinned.
- **A child's row must never wear the room's face.** `resolvePersona` hands any label grounded
  in a customized room the room's uploaded logo; a child session or an engine row has its own
  identity (icon, kind glyph, or initials) and clears `imageUrl` explicitly.
- **Quoted bash heredocs collapse `\\` here.** Appending TS tests with `cat >> … <<'EOF'` turned
  `"C:\\proj"` into `"C:\proj"`; write test files with the Write tool.
