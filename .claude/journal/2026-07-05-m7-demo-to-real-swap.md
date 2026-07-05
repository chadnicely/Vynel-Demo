# M7 — desktop UI demo → real API swap (2026-07-05)

The API is complete, so the desktop UI (`apps/local-web`) came off its hand-written demo data layer
and onto the real generated SDK. Sliced (advisor-blessed), green + committed each. `src/demo/` is gone.

## Slices (all on `main`, pushed)

- **A+B `78bbe2c`** — workspaces + dashboard (drop demo namespaces, real generated show through) + the
  **chat vertical keystone**: session reads, live SSE turn, approvals, interrupt — landed together
  (reads-real while writes-demo would render an empty list, so the advisor said keep them one slice).
  Reviewer SHIP-clean.
- **C `ddc275c`** — workspace drawer feature sections (skills/channels/schedules/knowledge/marketplace)
  → 5 thin `enabled`-gated per-domain read composables. Self-reviewed (trivial display reads).
- **E `8ff3bbd`** — composer model picker = real `CHAT_MODELS` contract (no models API — it's a static
  allowlist); the chosen model now rides on every turn body.
- **D `6e20489`** — files area rework (the one non-repoint) + reviewer pass. See below.

Gate went 1835 → 1839 (+ streamer/parser tests, − deleted demo tests).

## Key design calls

- **Streaming has no SDK helper.** The generated `startTurn` uses openapi-fetch's `POST`, which
  resolves + parses the whole body → it BUFFERS, useless for SSE. So live turns call the typed
  path-keyed `client.POST(path, { parseAs:'stream', signal })` (openapi-fetch 0.14 supports it → `data`
  is the raw `ReadableStream`) and a pure `sse-frames.ts` parser turns bytes → `ChatTurnEvent`. The
  `applyChatTurnEvent` fold was UNCHANGED — it was already typed to the full 15-member contract union;
  the demo player just emitted a subset. Only net-new code = the parser + a thin streamer (both in the
  app, unit-tested). Terminal frame is `data:'{}'` → recover `kind` from the `event:` name.
- **Global vs workspace are different namespaces.** Workspace chat = `client.chat.*(workspaceId)`;
  global root = `client.root.*()` (user-scoped, no workspaceId). The demo's "global = a workspace with
  a magic id" trick is gone. Global has NO session list (product-correct: one continuous brain) and NO
  interrupt endpoint (abort-only). Global thread reads `root.getSession(currentSdkSessionId)` (rich,
  same type as workspace) not `getTranscript` (whose lean message type ≠ `ChatMessageResponse`).
- **Approvals reuse the existing decide mutation.** The SSE `approvalRequestId` IS the
  `providerApprovalId`, and the user-scoped `approvals.decide` resolves any of the user's approvals — so
  inline cards route through the existing `useDecideApproval`, and the running stream reflects the
  resolution via `approval-resolved`. `use-chat-turn` sheds decide entirely (it only streams +
  interrupts). `denied` needs a `reason`.
- **Contracts were stale vs the wire.** `ChatSessionResponse.workspaceId` (nullable on the wire —
  global sessions) and `ChatToolCallResponse.toolInput/toolOutput` (`z.unknown()` → optional key) didn't
  match the generated types the components now consume. Root-fix = align contracts to the wire; blast
  radius was contained (only `@vynel/ui` tool-cards + web import them — no backend importer), verified
  before changing.
- **Files: the real API is lazy + async, not a nested tree.** `files.tree(wsId,{path?})` lists ONE
  directory → `FileTreeNode` fetches its children on expand (`enabled` gated on `isOpen`, so a file node
  never fires a tree call). The editor reads async (`readContent`) and saves to REAL disk
  (`saveContent`). Truncated/binary files open READ-ONLY (`isEditable = isText && !isTruncated`, gated in
  template AND `save()`) — a partial buffer must never overwrite the file.

## Reviewer caught a HIGH data-loss bug in the files slice

Edit file A (dirty) → click uncached file B: vue-query flips `contentQuery.data` to `undefined` for one
flush (no placeholderData), which consumed the editor watch's `filePathChanged` detection, leaving A's
dirty draft bound to B → Save wrote A's content to B's disk path. Deterministic, common flow. Fix:
`:key="filePath"` on `<FileEditorView>` → a fresh instance per file eliminates the whole cross-file
state-leak class, while a stable key on same-file refetch still preserves unsaved edits. Plus 2
should-fixes: surface save failures (real disk writes must not fail silently) + pass `workspaceId` as a
getter in `FileTreeNode` (a reused node could otherwise serve a prior workspace's children).

**Lesson:** an async-populated buffer that a `watch` re-syncs is a data-loss trap under
`refetchOnWindowFocus` + per-key `undefined` ticks. `:key` per document is simpler and safer than
watch-based reconciliation. Ran the FULL code-reviewer on the disk-writing slice (not self-review) —
it earned its keep.

## Still demo / parked (NOT M7 data)

- `VoiceOverlayDemo` — the Jarvis voice animation (UI, no data) until the voice engine lands.
- Deferred-improves (logged in STATE): interrupt() silent catch (no app logger by design) · client-drop
  error flash · `saveContent` no ETag guard · approval `actionKind` absent · live delegation drill-down
  (no per-session-subscribe endpoint).

## Chad to smoke-test live (can't be unit-tested)

Boot local-api + local-web, register a workspace, run a chat turn (stream + approval), open/edit/save a
file (disk write, alt-tab-preserves-draft, truncated/binary read-only), expand a folder (lazy load).
Real data = empty until seeded — an empty first boot is correct.
