# voice pull — `@vynel/voice` (2026-07-04)

**Warmup module of the "remaining leaves" autopilot mission** (voice · marketplace · skills ·
channels · schedules). Faithful move, zero improve.

## What landed
New leaf package `@vynel/voice` — the stateless voice-relay functional core moved byte-faithfully
from `core/src/voice/` (source branch `refactor/session-library`): `ack-library`,
`audio-segmenter`, `barge-in`, `relay-task-notifier`, `sentence-buffer`, `summarize-turn-for-voice`,
`turn-taking-gate`, `wake-word` (+ colocated tests + barrel). 17 src files, flat (no fold — 8
cohesive single-responsibility peers, under the flat-is-fine threshold; correct per capabilities/
provider-preferences precedent).

## Shape
- Owns **no DB tables** (stateless) — like `embeddings`/`desktop-control`. No vertical-slice.
- Sole cross-package dep: `@vynel/providers` (`import type NormalizedSessionEvent`, type-only, 4
  files) — a docs-sanctioned leaf dependency (architecture §3 reuse-contract row 3; providers is the
  stateless AI-seam helper). Zero runtime edge to providers (tsc elides the type imports).
- Hand-written package files only: `package.json` (mirrors embeddings) + `tsconfig.json` (mirrors
  desktop-control, extends base). No root-config edit needed (`packages/*` glob + root vitest
  `packages/**/*.test.ts` include auto-pick-up).
- **No HTTP surface** — voice is not a route feature (audio/turn-taking helpers consumed by the voice
  app). Its API vertical is intentionally skipped.

## Gate
- Byte-faithfulness PROVEN: every `packages/voice/src/*.ts` diff-identical to source.
- Full `pnpm test` green — **1241 passed / 4 skipped** (prior 1193 + voice 48). typecheck + parity
  clean.
- `code-reviewer`: CLEAN, zero MUST-FIX (package shape correct, invariants intact, flat correct).

## Note for later
`packages/contracts/src/schedules/one-time.test.ts` already exists — the contracts package already
carries schedule-kind (recurring/one-time) schemas. Reuse it when building the schedules vertical +
the one-time improve.
