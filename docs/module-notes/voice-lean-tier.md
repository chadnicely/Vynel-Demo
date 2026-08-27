# Voice lean tier — module notes + plan

*Opened 2026-08-27 from Kafi's directive: the voice session should skip the Claude host
resources entirely (no CLAUDE.md, no native toolset — MCP tools only), run a lean prompt
(just the voice base), say something BEFORE acting, and run on haiku 4.5 with sonnet 5 as the
only other permitted model — a latency test. Review first; this doc is the findings + the plan.*

---

## 1. Findings — what a voice turn carries today (reviewed 2026-08-27)

Every leg of the scope-`'voice'` thread (wake overlay, typed Voice panel, and since
`78a10fd1` the report-notify leg) composes through `runGlobalRootTurnCore` and the provider:

1. **Host Claude resources load on EVERY session** — `buildClaudeSdkOptions` sets
   `settingSources: ['user', 'project', 'local']` unconditionally
   (`packages/providers/src/claude/base/build-claude-sdk-options.ts:164`): the user-level
   `~/.claude/CLAUDE.md`, rules and settings ride into the voice thread (the hidden cwd has no
   project files, but the USER source always resolves — the instruction-channel evidence's
   "dev CLAUDE.md leaks via settingSources", now on a spoken surface). `autoMemoryEnabled:
   false` is already handled.
2. **12 native Claude Code tools attach** (`CLAUDE_CODE_BASE_TOOL_NAMES` — Bash/Read/Edit/…):
   thousands of tokens of definitions per request, on a surface whose own rule is
   "route, don't do project work yourself".
3. **User-scope SDK agents compose onto voice turns** (`composeSessionAgents` runs for the
   global stream's voice branch too) — more definitions, for subagents a spoken turn should
   never spawn.
4. **The system prompt is a stack, not a base**: `voice-base` + the `global-root` kind file
   (~450 words) + every attached MCP feature's prompt section + any steer
   (`run-global-root-turn-core.ts buildSystemPromptAppend`). Per message: the turn-time marker
   + the one-line voice-turn marker (catch-up is already gated off voice).
5. **The model is pinned sonnet-5 / low / auto** (`@vynel/contracts/chat/voice-tier`,
   session-hardening D2 — server-forced, row never read/written; the daemon, overlay and Voice
   panel all send the same constant). The fit-clamp (`fitPinnedModelToSession`) falls back to
   "the session's own model" when the pin can't hold the occupancy.
6. **The prompt says the opposite of talk-first** for quick work: voice-base rule 4 is "do it
   FIRST, say nothing while you do it, then say the result".
7. **A window subtlety that will bite the haiku test**: the chain's context-window denominator
   is sticky by design (`lastContextWindow` copies forward on swap; a small-model visitor
   never lowers it). The existing voice chain was driven on sonnet's 1M window, so on a fat
   existing chain the haiku pin will simply be fit-clamped away every turn. **The haiku test
   needs a fresh voice chain** to actually run haiku.

## 2. The plan

Scope: the scope-`'voice'` THREAD legs only (wake overlay · typed Voice panel · notify leg).
The per-call spawned-session leg stays its own parked arc.

1. **Provider seam — one agnostic field.** `StartChatSessionInput` gains
   `hostResources?: 'full' | 'none'` (default `'full'`, every shipped caller unchanged).
   `'none'` → `settingSources: []` and `tools: []` — no CLAUDE.md, no user settings, no native
   toolset; the MCP servers and every hook/gate stay exactly as composed. SDK detail stays
   quarantined in `providers/claude/base`.
2. **Voice legs pass `'none'`** and skip `composeSessionAgents` — MCP tools become the entire
   surface, as directed.
3. **Prompt diet.** On a voice turn the `systemPromptAppend` is the voice base ONLY — the
   `global-root` kind file and the MCP feature sections are dropped. The base absorbs the two
   load-bearing routing lines (hand work to a workspace with `send_message`; reports come back
   here on their own) so nothing essential is lost.
4. **Rewrite `voice-base.md` — talk first, then act.** New spine: ALWAYS say one short
   sentence in your own words about this request BEFORE any tool call; then act in silence;
   then one line with the outcome. Keep the spoken-shape rules (1–2 sentences, no symbols,
   detail to the Display), trim the rest for tokens. The per-message voice-turn marker stays
   (the decay evidence that created it still holds).
5. **Models: haiku first, sonnet the only fallback.** `VOICE_TIER_MODEL` →
   `'claude-haiku-4-5'`; new `VOICE_TIER_FALLBACK_MODEL = 'claude-sonnet-5'`;
   `resolveVoiceTierSettings` clamps the fit fallback to that constant (never "the session's
   own model"), making {haiku-4.5, sonnet-5} the entire voice model universe at one home. An
   env override `VYNEL_VOICE_TIER_MODEL` (validated to those two values) gives the A/B lever
   without a code flip.
6. **Ship notes:** the daemon + web read the tier from `@vynel/contracts` — sidecar rebuild
   required, and the wake chain gets its launch-test (the compiled-shell rule). The haiku test
   starts on a FRESH voice conversation (finding 7).

## 3. Forks (Kafi accepted the recommendations, 2026-08-27)

- F1 — haiku default + `VYNEL_VOICE_TIER_MODEL` env A/B lever. F2 — SDK agents skipped on
  voice. F3 — voice-turn marker kept. F4 — lean prompt.

## 3b. As-built notes

- **The base had to split, not absorb** (found in build): the live-call leg composes
  `voice-base` + `spawned-session`, so thread duties baked into the shared base would lie to a
  call session. As built: `voice-base.md` = the shared spoken identity (talk-first spine, spoken
  shape, ground rules incl. the duty-book line the alignment test pins), and a new few-line
  `voice-thread.md` = the routing duty; the voice THREAD composes exactly those two. The call
  leg keeps `voice-base` + `spawned-session` and inherits talk-first for free.
- The provider field landed as `hostResources: 'full' | 'none'` on `StartChatSessionInput`;
  `'none'` empties `settingSources` + the native `tools` whitelist only — hooks, gates, and
  `autoMemoryEnabled: false` untouched (pinned by test).
- `VOICE_TIER_ALLOWED_MODELS` = [haiku-4-5, sonnet-5] in the contract; the fit clamp lands on
  `VOICE_TIER_FALLBACK_MODEL`, never the session's model or the engine default (test
  expectation corrected — the old "engine default on overflow" contradicted the two-model rule).
- **No daemon rebuild needed for the test**: the server forces the tier for voice turns, so a
  stale sidecar sending sonnet still runs haiku. The web Voice panel's read-only chips show the
  old constant until the next web build — cosmetic.

## 3c. Deferred (Kafi, at build time)

- **Trimming which MCP/system tools attach to voice** — "we will build a feature; we will
  remove some system tools later." The composition is untouched this arc.
- The boundary swap's PRIMING turn still starts full-host (one request per swap — negligible,
  and scope-agnostic plumbing to change).
- The stale `send_task_to_workspace` naming in `global-root.md` (the unified tool is
  `send_message`) — the global brain's own file, not this arc's.

Reviewer notes on the shipped diff (code-reviewer, clean verdict — should-fixes applied:
env validates via `VOICE_TIER_ALLOWED_MODELS`, stale tier comments updated, voice-thread
name-pin test added). Carried observations, pre-existing and deliberate: the voice-base ground
rule directs memory/journal writes but the spoken THREAD's surface attaches no memory/journal
tools (executable on the call leg only — the same leg-mismatch class the voice-thread split
answers; candidate for Kafi's later MCP-toolset feature); the approval-card line is aspirational
under the tier's locked `auto` (no card ever fires on voice — product wording, pinned by the
alignment test); the tier flip also reaches the live-call leg (haiku pin, full host — coherent,
clamp is the safety); `run-global-root-turn-core.ts` is past the ~300-line cap (split next
touch).

## 4. Verification

- Provider options test: `hostResources: 'none'` → empty settingSources + tools, everything
  else byte-identical; default 'full' unchanged.
- Settings test: voice tier resolves haiku; fit-overflow resolves sonnet-5, never the chain's
  model; env override honored + rejected outside the two.
- Compose test: a voice turn's append is exactly the voice base.
- Kafi's live smoke: fresh voice conversation on haiku — first-syllable latency, talk-first
  behavior, a routed task still reporting back to the voice thread (the `78a10fd1` arc's
  smoke rides along).
