# 2026-07-04 — @vynel/session Slice 1 (the keystone begins: continuity + primary rename)

Started the keystone and the first real work was **discovery, not code**. STATE framed `@vynel/session` as a
grand unifier of a 28-file spread. The source's own owner-approved docs
(`b-lead-session-library-design.md` + `session-migration-plan.md`) say the hard refactor was **already done**
(B0–B2b: SessionSink, the global-root twin collapsed, the global-root runner relocated) and the
**generic-runner unification was dropped** as wrong-shaped (the runners share ~10 lines; workspace + leaf
runners belong to chat + orchestration). So the pull is a faithful move of already-refactored code — much
smaller than STATE said. This reframing was the real value of the Gate-1 pass.

**The one load-bearing decision — where continuity lives — took three swings.** (1) I leaned continuity ∈
session (the owner's call). (2) The Explore map showed continuity is used by monitor + others → I flipped to
"continuity = shared substrate below" (the migration plan's shape). (3) The owner **cut monitor entirely** —
which removed the one entanglement (`session → monitor → continuity → session`), and stated the model:
*session is the parent of chat; any package calls session → stream|response.* Re-verified: every continuity
importer is session-tier or an app; chat + orchestration are continuity-FREE. So continuity ∈ session is
cycle-free — **and it ratifies the chat pull's exclusion of `start-chat-turn`** (the two decisions are
mutually reinforcing). The migration plan's contrary "continuity in core" was a **monolith-specific** artifact
(a `core ↔ session` cycle that decomposition removes).

The advisor caught me mid-analysis: I'd verified what `start-chat-turn` *imports* but not who *invokes* it.
Schedules does (in the source) — which looked like it broke the shape — but invariant #2 forbids
`schedules → chat/session` regardless, so schedules decouples (outbox / injected dep) either way, and the
runner's home is unconstrained by it. Verify the inbound edge, not just the outbound.

**Slice 1 execution (faithful-first, then the rename):**
- **1a** — git-mv `primary_sessions` (was `root_sessions`) schema+repos from the kernel + pull the 13-file
  continuity logic into `src/continuity/` (kept `internal/`). One rewire (`@vynel/db/repositories/session-continuity
  → ../repositories/index.js`) + hub FKs. Diff-proven byte-faithful; drizzle "No schema changes"; gate green
  (the checkpoint the owner wanted before the rename).
- **1b** — the `root → primary` rename, done in careful chunks: enumerate every `root` token first, rename the
  unambiguous compounds (`RootSession`/`rootSession`/`RootConversation`/`root_sessions`) + targeted identity
  vars, then the bare-`root` concept sweep EXCLUDING the filesystem store (`rootDir` is a filesystem root, not
  the identity). git-mv 11 files; typecheck between each chunk caught path/symbol drift. **Migration folded
  into the baseline** (owner's call — pre-release, zero data): edited `0000_baseline.sql` + snapshot to define
  `primary_sessions` directly; "No schema changes" proves the fold is consistent.

**Learnings:**
- **`\broot\b` matches inside kebab paths** (`root-sessions.js` → `primary-sessions.js`) — convenient (it did
  the path rename), but it means the file git-mv is what makes typecheck resolve. Rename tokens, then files.
- **Precedent set (owner):** pre-release schema changes **fold into the baseline**, not incremental migrations
  — valid while zero data exists; increments resume post-deployment.
- **A big rename is chunk-and-verify:** compounds → targeted → bare-word (with exclusions) → files → baseline,
  typecheck between. A blind `s/root/primary/` would have corrupted `rootDir` + the Tier-2 delegation vocab.

**Next:** Slice 2 — the runners (global-root + workspace `start-chat-turn` + seeded-swap + Hono-free
resolvers/composers) + the web-safe mode barrel + `./runtime` subpath. Full plan in `docs/module-notes/session.md`.
