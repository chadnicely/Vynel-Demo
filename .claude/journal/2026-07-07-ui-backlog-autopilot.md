# 2026-07-07 — UI-backlog autopilot (wizard · workspace create · approval cards · watch panel)

Chad's brief: "work on autopilot on our missing UIs — the APIs are complete — cover beautiful UIs
everywhere." Four moves shipped (`bf3bdba` → `d61f1a4` + docs `6eb136a`), each gate-green +
reviewer-APPROVEd. Full record in `.claude/STATE.md`; user-facing story in `CHANGELOG.md`.

## Learnings worth keeping

- **The first-launch gate is best detected in ONE place: the vue-query caches.** A
  QueryCache/MutationCache `onError` matching the 412 envelope beats a boot probe — it honors the
  server's env flag (gate off → no forced wizard) and needs zero per-view handling. The wizard
  REPLACING the shell (not overlaying it) is what stops every poller from hammering the gate.
- **Web-safe subpath exports are the cheap bridge for pure leaf logic.** `@vynel/approvals/action-kind`
  ships `deriveActionKind` to the browser because its only import is `import type` (erased at
  transform). Pattern: pure-function file + a subpath export beats widening a wire contract when the
  UI just needs the same classification the server already computes. Precedent chain:
  `@vynel/session` web-safe barrel → this.
- **Teleport + test-utils gotcha:** a `<Teleport to="body">` dialog outlives its test — the next
  test's `document.body.querySelector` grabs the STALE dialog and assertions chase the wrong
  instance. Fix: track the wrapper, `afterEach` unmount + `document.body.innerHTML = ""`.
- **Stacked-overlay Escape etiquette:** inner overlay `preventDefault()`s the Escape it handles;
  outer document-level listeners bail on `event.defaultPrevented`. Two lines, kills the
  double-close class.
- **Onboarding UI can't read gated catalogs.** During the run only `/onboarding/*` passes the gate,
  so the skills step labels suggestions from their ids. If richer labels matter, the snapshot
  (server-side, ungated) should carry them — a contract ask, not a UI hack.

## Deferrals (deliberate)

Voice-settings surface (daemon is env-at-boot; needs a settings API design with Chad) ·
`approval-requested.actionKind` on the SSE contract · `--ink-on-gold` token sweep.
