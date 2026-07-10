# 2026-07-11 — Chad's five-fix round (voice UX · dictation · attachments · knowledge indexing · memory tags)

**The ask (Chad, verbatim intent):** refresh the vision so every decision centers the non-technical
community member (workshops fund the tool; the tool is free), then fix: ① top-bar mic opens the
voice overlay, always mid-screen; ② the composer mic only TYPES (dictation); ③ paste files/images
in chat; ④ knowledge folders/files actually index; ⑤ memory tags (multi, user-created + defaults)
with the special `context` tag carrying workspace context into fresh sessions, memory/knowledge
from file or text.

## What made this round interesting — the gaps were mostly WIRING, not missing features

- **Attachments (③):** the whole workspace pipeline existed and was tested (schema → provider temp
  files → persistence → re-display route) — but the UI threw the files away (`void attachments`)
  and the GLOBAL root turn had no attachment fields at all. The fix was threading, not building:
  the UI now encodes+validates (plain-words rejects), and the root turn mirrors the workspace path
  (its hidden user-data cwd IS a workspacePath for the D22 layout — no new invention needed).
- **Knowledge (④):** indexing "didn't work" because of two runtime absences, both invisible in
  tests: watchers are in-memory (never restored on restart — an acknowledged follow-on comment in
  server.ts), and `apps/worker` — the ONLY registered embeddings runner — is launched by NO dev
  script and NO sidecar. Lesson: **a feature green in vitest can be structurally dead in the
  product if no process runs it.** The api-side service pattern (schedules/channels precedent) is
  the right Phase-1 home; the worker stays as the split-deployment twin.
- **Memory (⑤):** same absence — `generateMemoryEmbeddings` + the retention purge were registered
  NOWHERE, so memory semantic search has been silently FTS-only since the pull. Swept the same
  pattern while fixing knowledge (per the fix-then-sweep rule).

## Decisions worth remembering

- **`context` as a reserved TAG, not a schema enum** — the module-notes two-layer design collapsed
  to one open tag table + one well-known constant. Selectivity with a graceful fallback (no
  context-tagged entries → old top-10-per-kind) means the feature can't make memory WORSE before
  users learn it.
- **Memory-from-file = one-shot IMPORT, size-capped, pointing big files at Knowledge** — a watched
  `memory_sources` registry duplicating knowledge's pipeline was deliberately deferred; standing
  memory must stay curated (it rides every session start). The error message does the teaching.
- **Kept the `attachedImages` name** (wire + column) despite docs riding in it — 128 occurrences /
  43 files made the honest `attachments` rename a separate mechanical sweep, not a rider on a
  5-feature session. Recorded as deferred debt here and in STATE.
- **Dictation reuses `createCommandRecognizer`** (the tested voice-command STT) rather than a new
  recognizer — the 5s endpointing + restart-stitching behavior is exactly right for dictation; the
  only new logic is the draft-append + the send-race `cancel()`.

## Live-smoke catch (Chad's boot log): the poisoned embedding cache

Chad's first boot proved the services (watchers restored, 6-file catch-up scan) — and surfaced a
corrupt-model failure: transformers.js caches the MiniLM download INSIDE node_modules, my earlier
mock-less test run died mid-download, and the truncated `model.onnx` (9.5 MB of ~90) was trusted
forever → "Protobuf parsing failed" per chunk, 50 stack traces per minute. Four-layer fix:
1. `configureEmbeddingsCacheDir()` — cache moved to `.models/embeddings` (voice-models precedent;
   survives reinstalls), wired at api + worker boot via `VYNEL_EMBEDDINGS_CACHE_DIR`.
2. Corrupt-cache SELF-HEALING: a protobuf-parse load failure evicts the cached model + retries
   once; a failed pipeline promise no longer poisons every later call.
3. Both embedding ops abort the batch with ONE actionable error when the first item fails before
   any success (it's the model, not the chunk) — no more per-chunk stack spam.
4. Switched to the q8 quantized model (~23 MB vs ~90) — free NOW because no vector was ever
   successfully generated anywhere (version suffix unchanged, nothing to invalidate); a far better
   first-run for a non-technical user. Live-smoked: download to the new dir + a real 384-dim
   embedding in 16 s.

## Live-smoke catch #2 (Chad's tool call): capabilities were silently OFF everywhere

Chad's first real `search_knowledge` call came back "Permission denied." Diagnosis:
`workspace_capabilities` was EMPTY — nothing seeds rows at workspace creation, and both
`listEnabledCapabilities` and the status panel treated no-row as OFF. Net effect on every fresh
install: all 7 knowledge tools denied, (after the review fix) all 6 memory tools denied, AND the
memory session-start snapshot never composed — the product's two core capabilities were dead by
default while the UI happily let the user add folders and memories the assistant then couldn't
touch. Textbook vision-litmus failure, invisible to tests because every test that wanted a
capability explicitly enabled it.

**Fix: first-party capabilities DEFAULT ON; a `workspace_capabilities` row is an explicit toggle
override.** One home — the catalog gained `defaultEnabled`; `listEnabledCapabilities` +
`listCapabilityStatusForWorkspace` resolve catalog-first, so tools, the memory snapshot, and the
panel display can never disagree. No seeding step to forget, no migration, existing + future
workspaces heal instantly, opt-out still wins. ("Defaults protect; power is opt-in" is about
irreversible ACTIONS — reads of content the user explicitly added were never what that principle
gates; the writes stay approval-carded.) Spec tests updated as deliberate spec changes.

## Test learnings

- `vi.mock('@vynel/embeddings')` in an apps/local-api test silently NO-OPS if local-api doesn't
  depend on the package (pnpm strict resolution → different/unresolvable module id) — the real
  MiniLM loaded mid-unit-test. Fix: add the workspace devDep so the mock's resolved id matches.
- The service test caught a real sequencing flaw: the immediate embeddings tick fired BEFORE the
  catch-up scan created chunks (fresh chunks then waited a full minute). Tick-after-catch-up fixed
  product behavior, not just the test.
