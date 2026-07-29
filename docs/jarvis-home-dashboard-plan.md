# Home, Reinvented — The Jarvis Dashboard

**Design + implementation plan · 2026-07-28 · target: `apps/local-web/src/views/HomeView.vue` and friends**

Chad's brief: realtime — how many sessions running, which session is doing what inside which
workspace, tasks completing with beautiful animation; small attention widgets (news, weather,
user-preference smalls); usage shown; creative, aesthetic, delightful — for a **non-technical**
user.

Every data source below was verified in code before planning: the activity feed carries per-tool
step narration for every turn, tasks emit a `task.completed` outbox event, per-session context
occupancy is already on the wire, and a real user-preferences KV surface exists.

---

## 1 · CONCEPT

### The emotional read

Home is the window into a quiet, competent household staff. When nothing is happening, the room is
calm: a warm greeting, the day ahead ("your briefing fires at 8, two things on the list"), the
weather outside, a headline or two — the screen barely moves, like a fireplace at low ember. The
moment Claude starts working, the room *wakes*: a gold-edged card slides in per running session,
each narrating its current step in plain words — "**Noah · Invoices** — reading
`march-statement.pdf`" — and when a task finishes, its row draws a green check, lifts, and glides
down into the "delivered" shelf. The user should feel two things at a glance: *someone capable is
on it* and *nothing is happening behind my back*. Never a stats page; always a presence.

### Layout sketch

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Good morning, Gaurav                    ✳ (ClaudeMark, coral, small)      │
│  ● Two sessions working · 1 approval waiting for you        ← status line  │
├────────────────────────────────────────────────────────────────────────────┤
│  RIGHT NOW                                        (only when work runs)    │
│  ┌───────────────────────────────┐  ┌───────────────────────────────┐      │
│  │ ◉ Noah · Invoices      2m     │  │ ◉ Assistant thread      40s   │      │
│  │ reading march-statement.pdf   │  │ searching the web…            │      │
│  │ ▂▂▂ gold breathing edge ▂▂▂  │  │                                │      │
│  └───────────────────────────────┘  └───────────────────────────────┘      │
├──────────────────────────────────────────────┬─────────────────────────────┤
│  ON THE LIST                (span 2)         │  OUTSIDE          (widgets) │
│  ○ Renew domain             in progress ◌    │  ☀ 24° Kathmandu            │
│  ○ Draft pricing page                        │    clear · high 27°         │
│  ✓ Sent March invoices      just now  ← glides down on completion          │
│  ✓ Booked dentist           2h ago           │  ▤ Headlines                │
│                                              │  · BBC: …                   │
├──────────────────────────────────────────────┤  · The Verge: …             │
│  COMING UP                                   ├─────────────────────────────┤
│  ◷ Morning briefing        Tue 8:00 · repeats│  NEEDS YOU                  │
│  ◷ Weekly review           Fri 17:00        │  ⚠ 1 approval waiting →     │
├──────────────────────────────────────────────┼─────────────────────────────┤
│  RECENT CONVERSATIONS       (quiet list)     │  ROOM FOR THOUGHT           │
│  · Trip to Pokhara — Global chat · 3h        │  ◔◔◔  context rings, one    │
│  · Pricing research — Vynel · 1d             │  per active conversation    │
└──────────────────────────────────────────────┴─────────────────────────────┘
```

### How it breathes

- **Idle:** the "Right now" band is absent entirely (not an empty shell — the grid reflows). The
  status line reads "All quiet — everything your assistant does shows up here" with the muted
  `PresenceDot`. The only motion on screen is the dot's slow idle state and the clock-ish
  freshness of the widgets. The screen is *allowed to be boring*; that is the trust signal.
- **Working:** "Right now" slides in at the top (one card per server turn), each card wearing the
  gold breathing edge — the same gold-presence contract as `PresenceDot`
  (`packages/ui/src/styles/tokens.css:33-36`: *"If it glows gold, the assistant is alive there"*).
  Narration lines crossfade as steps arrive. When the last turn ends, the band lingers ~2s
  ("finished ✓"), then collapses.
- **Attention:** a pending approval turns the status dot to `attention` and raises the "Needs you"
  tile with the steady gold ring — no pulsing, no urgency theater (approvals also pop in the
  corner via the existing `ApprovalNotifier`).

---

## 2 · LIVE TILES — data sources (all verified in code)

### 2.1 Running sessions — "who is doing what, where" ✅ narration exists on the wire

**Verified:** the `/activity/stream` SSE feed carries **per-tool step narration for every turn**,
not just desktop turns:

- Producer tap: `packages/session/src/runtime/activity-turn-steps.ts:29-59` — every
  `tool-call-started` maps to `turn-tool-started { toolUseId, toolName, toolInput? }` (input
  bounded to 2 048 JSON chars, line 13), every completion to `turn-tool-settled { status }`, plus
  approval bells. Published through `SessionActivityFeed.publishTurnStep`
  (`packages/session/src/runtime/session-activity-feed.ts:80-86`).
- Wire: `apps/local-api/src/routes/activity/index.ts:40-63` (snapshot replay + live). Contract:
  `packages/contracts/src/chat/session-activity.ts:43-59`.
- Client subscription already mounted app-wide once:
  `apps/local-web/src/composables/activity/use-session-activity-feed.ts:26-103`, mounted in
  `apps/local-web/src/components/shell/AppShell.vue:77`.
- Turn lifecycle folds into `apps/local-web/src/stores/activity-store.ts:53-75` (`serverTurns`
  map: `turnId → { scopeKind, workspaceId, sessionId, origin, startedAt }`).

**Gap to fill (the one real new piece):** the activity store deliberately drops step events
(line 71 comment). The only step consumer today is desktop-only
(`apps/local-web/src/stores/desktop-activity-fold.ts:15` filters `mcp__desktop__*`). The dashboard
needs a small **turn-narration store**: fold `turn-tool-started/settled` into a per-`turnId`
*current step* (name + small input), exactly the `desktop-activity-fold.ts` pattern minus the
desktop filter. Pure fold + colocated test, same as the precedent.

**Per tile:**

| Datum | Source |
|---|---|
| Card exists / count ("Two sessions working") | `activity.serverTurns` — `activity-store.ts:18` |
| Workspace + persona label ("Noah · Invoices") | `workspaceId` from the turn joined to `useDashboardOverview().workspaces[].managerName` (`apps/local-api/src/routes/dashboard/index.ts:59`; persona resolution `packages/workspaces/src/manager-name.ts:28`); global turns label by `origin` ("via Telegram", "a schedule") from `session-activity.ts:18-25` |
| Live step line ("reading march-statement.pdf") | new narration store fed by the same feed; humanized via `displayToolName` (`packages/ui/src/tool-cards/tool-presenters.ts:59-63`) + the presenter verbs (`presentToolCall`, same file) |
| Elapsed time ("2m") | `startedAt` on the turn + a 1 s ticker |
| Delegated-task subtitle ("working on: *send March invoices*") | `GET /root/delegations` → `{ taskLabel, workspaceName, sessionName, status }` (`apps/local-api/src/routes/root/index.ts:253-281`), already polled by `use-in-flight-delegations.ts:11-19` |
| Card accent color per workspace | `workspaceColorSlot` (`packages/ui/src/lib/workspace-color.ts`) → `--ws-*` tokens |
| Click-through | `ui.openWorkspaceTab(workspaceId)` / route `chat` — the exact pattern in today's `HomeView.vue:49-56`; optionally "Watch" via `useActivityMonitorStore().openSession` (`apps/local-web/src/stores/activity-monitor-store.ts:72-74`) |

### 2.2 Tasks — completing with celebration

- List: `GET /dashboard/overview` → `openTasks` + `recentlyCompletedTasks`
  (`apps/local-api/src/routes/dashboard/index.ts:74-79`; shape
  `apps/local-api/src/routes/tasks/serializers.ts:9-24` — `title, status, workspaceId,
  completedAt`).
- Completion **event** exists (`task.completed`, `packages/tasks/src/tasks-events.ts:21,40-45`)
  but the outbox relay (`apps/local-api/src/services/outbox-relay-service.ts`) has no UI push
  channel — **do not build one for this**. Detect completion *client-side*: keep the previous
  overview snapshot; when a task id moves `open → done` between refetches, run the celebration.
  Freshness: invalidate `dashboardKeys.overview()` + `taskKeys.list()` on `turn-ended` in
  `use-session-activity-feed.ts:35-42` (one added line each), and poll the overview at 5 s *only
  while* `activity.isTurnRunning` — the exact cadence pattern `SessionsView.vue:35-37` already
  uses.

### 2.3 Schedules — coming up

`upcomingSchedules` on the same overview (`dashboard/index.ts:64-68`, enabled + soonest-first;
serializer `apps/local-api/src/routes/schedules/serializers.ts:14-37` — `displayName`,
`nextScheduledFireAt`, `scheduleKind`, `lastFiredAt`). Upgrade the copy from a timestamp to
distance ("in 2 h", "tomorrow 8:00") via `formatRelativeTime`
(`apps/local-web/src/utils/format-relative-time.ts`). When a schedule *fires*, its turn appears in
"Right now" with `origin: 'schedule'` — the two tiles hand off naturally.

### 2.4 Approvals — needs you

`usePendingApprovals` (`apps/local-web/src/composables/approvals/use-pending-approvals.ts:9-21`,
5 s poll) **plus** instant push: approval bells on the feed already invalidate the pending query
(`use-session-activity-feed.ts:66-74`). The tile shows count + the tool name from the newest
request; clicking focuses the existing `ApprovalNotifier` flow. No new data work at all.

### 2.5 Usage — context occupancy

`GET /sessions/overview` returns per-conversation `contextTokens` (numerator) and `contextWindow`
(denominator, `resolveContextWindow` — `packages/contracts/src/chat/sessions-overview.ts:33-35`,
`packages/contracts/src/chat/model-context-window.ts:18-25`). Client: `useSessionsOverview`
(`apps/local-web/src/composables/sessions/use-sessions-overview.ts`) — vue-query dedupes with the
Sessions view. Render with the existing **`ContextRing`**
(`packages/ui/src/components/ContextRing.vue` — currently only used inside `ChatComposer`): one
small ring per *recently active* conversation, labeled in plain words ("Global chat — about ⅓
full · continues automatically when full"). Never the word "tokens" on screen; the tooltip may say
"~166k of 200k".

---

## 3 · ANIMATION LANGUAGE

House rules first: **gold = presence only** (tokens.css contract), motion tokens `--ease-out` /
`--t-fast` / `--t-slow` (`tokens.css:88-90`), CSS-only (the `VoiceOrb` precedent — six states,
zero canvas/WebGL, `packages/ui/src/components/VoiceOrb.vue:2-4`), no animation library.
`<Transition>`/`<TransitionGroup>` are already house style (`ApprovalNotifier.vue`,
`ThreadStream.vue`, etc.).

1. **Session card pulse** — reuse the `presence-breathe` box-shadow keyframe from
   `PresenceDot.vue:43-51` scaled to a card: a 1-px gold border whose outer `--gold-soft` glow
   breathes on a ~2 s cycle. Static gold border under `prefers-reduced-motion` (exact fallback
   `PresenceDot.vue:53-58` uses).
2. **Narration line change** — Vue `<Transition mode="out-in">`: old line fades down 4 px, new
   fades up, 120 ms (`--t-fast`). Coalesce: never swap more than ~1×/800 ms (tools can settle in
   bursts); a tiny "keep latest, flush on timer" ref does it.
3. **Task completion** — three beats, ~900 ms total, all CSS + `<TransitionGroup>`:
   - *Check draw* (300 ms): inline SVG checkmark, `stroke-dasharray`/`stroke-dashoffset`
     transition — the same SVG-stroke technique `ContextRing.vue:72-74` already uses for its arc.
   - *Row settle* (200 ms): background washes `color-mix(in srgb, var(--ok) 10%, transparent)`
     then fades; title crossfades to muted + line-through (today's `.is-completed` style,
     `HomeView.vue:359-363`).
   - *Glide* (400 ms): the row moves from the open list to the "delivered" shelf via
     `<TransitionGroup>`'s FLIP `.v-move` transition — the browser does the interpolation; no JS
     math.
   - Reduced motion: skip beats 1–3; the row simply appears in the shelf.
4. **"Right now" band enter/exit** — `<Transition>` on the band: enter = 240 ms fade + 8 px rise
   (`--t-slow`); exit after a 2 s "✓ finished" linger, height collapse via
   `grid-template-rows: 0fr → 1fr` (pure CSS, no measured heights).
5. **Count-up numerals** (sessions working, approval count) — CSS `@property --n` + `transition`
   with `counter()` where supported; instant swap otherwise. Ten lines, no library.
6. **Reduced-motion is dual-gated:** the CSS media query **and** the stored `reducedMotion`
   preference (`packages/core/src/users/get-user-preferences.ts:14,21` — it already exists in the
   DB). Apply as `data-reduced-motion` on the dashboard root so one attribute kills all keyframes.

**Banned:** confetti, particle bursts, parallax, skeleton shimmer on this screen, anything that
loops fast while idle. Celebration is *satisfying*, not *loud* — the model is a good watch face,
not a slot machine.

---

## 4 · WIDGETS — news, weather, user smalls

### Where preferences live (existing surface)

`GET/PATCH /users/me/preferences` (`apps/local-api/src/routes/users/index.ts:7-8`) over a KV table
with a whitelist parser that **silently ignores unknown keys — explicitly forward-compatible**
(`packages/core/src/users/get-user-preferences.ts:1-5,53`). Add three keys (edits in exactly three
places: the `ResolvedUserPreferences` interface + defaults + switch in `get-user-preferences.ts`;
`SetUserPreferencesRequestSchema` + `UserPreferencesResponseSchema` in
`apps/local-api/src/routes/users/schemas.ts:14-37`; then `pnpm api:generate`):

- `homePlace: { name: string; latitude: number; longitude: number } | null` (default null)
- `newsFeedUrls: string[]` (default `[]`)
- `homeWidgets: { weather: boolean; news: boolean }` (default both true)

### Weather — no key, no proxy

**Open-Meteo** (`api.open-meteo.com/v1/forecast`): free, keyless, CORS-enabled — fetch straight
from the webview; geocoding for setup via `geocoding-api.open-meteo.com/v1/search` (also keyless).
First-run: the tile shows "Where's home?" with a one-line city input → geocode →
`PATCH /users/me/preferences { homePlace }`. Timezone from `GET /me`
(`apps/local-api/src/routes/users/serializers.ts:16`). Cache last payload in `localStorage`;
refetch every 30 min. Weather-code → icon map is a ~20-line util; plain-language copy
("clear · high 27°").

### News — RSS via a passthrough proxy (the one new endpoint)

RSS endpoints rarely send CORS headers, so the webview can't fetch them directly. Add **one thin
route**: `GET /widgets/feed?url=…` in `apps/local-api/src/routes/widgets/index.ts` — validate the
URL is in the user's stored `newsFeedUrls` (never an open proxy), server-side `fetch` with a short
timeout, relay body + content-type. **No XML dependency anywhere:** the browser parses with native
`DOMParser` (`text/xml`) in a small pure util (`parse-rss.ts`, colocated test with fixture
strings). Default feeds offered at setup (BBC, AP, The Verge…), fully user-editable. Show max 4
headlines, title + source + age; click opens externally.

Route follows the locked Hono protocol (`describeRoute` → validator → `...userScoped` → thin
handler, **no** `x-mcp` — UI-only read), the `dashboard/index.ts` precedent.

### Graceful degradation (the tile contract)

Every widget follows one rule set: **configured + fresh** → render; **configured + fetch
fails/offline** → render the cached copy with a quiet "as of 9:14" stamp — never a red error on
Home; **cache empty too** → the tile *removes itself* (grid reflows; a broken widget must not
advertise its brokenness); **not configured** → one-line invitation, dismissible, dismissed state
in `homeWidgets`. The dashboard proper (sessions/tasks/schedules/approvals) never depends on any
widget — the internet can be down and Home still works, because everything else is localhost.

---

## 5 · BUILD PLAN — ordered, independently shippable slices

New components live in `apps/local-web/src/components/home/` (the `components/<area>/` house
pattern); `HomeView.vue` becomes composition + grid only (≤300-line rule). Every slice ships its
colocated tests and passes `pnpm test`.

**Slice 1 — Turn narration store + "Right now" band** (the centerpiece) · *~1.5 days*
- Create `apps/local-web/src/stores/turn-narration-fold.ts` (pure fold: steps → per-turn current
  step + last-settled flash; clone of `desktop-activity-fold.ts` minus the desktop filter, capped
  map) + `turn-narration-store.ts` + tests.
- Modify `apps/local-web/src/composables/activity/use-session-activity-feed.ts` — one
  `narration.apply(event)` line beside the existing two `apply` calls (lines 63-64), plus
  `reset()` beside lines 84-85, 100-101.
- Create `components/home/LiveNowBand.vue` + `LiveSessionCard.vue` (persona label, origin copy,
  narration `<Transition>`, elapsed ticker, gold breathing edge, workspace accent, click-through +
  Watch chip).
- Modify `HomeView.vue` to mount the band; status line gains the working-session count.

**Slice 2 — Task celebration** · *~1 day*
- Modify `use-session-activity-feed.ts:35-42`: also invalidate `dashboardKeys.overview()` +
  `taskKeys.list()` on `turn-ended`.
- Modify `HomeView.vue`'s overview query:
  `refetchInterval: () => activity.isTurnRunning ? 5000 : false` (the `SessionsView.vue:35-37`
  pattern).
- Create `components/home/TasksCard.vue`: previous-snapshot diff → celebration flag;
  `<TransitionGroup>` FLIP glide; SVG check-draw; reduced-motion gate. Pure diff helper + test
  (`recently-completed-diff.ts`).

**Slice 3 — Usage tile** · *~0.5 day*
- Create `components/home/UsageCard.vue` riding `useSessionsOverview` (already deduped) +
  `ContextRing` (export exists in `packages/ui/src/index.ts`). Show the 2–3 most recently active
  conversations; plain-language labels; nothing when there are no sessions yet.

**Slice 4 — Schedules + approvals tiles, grid + idle polish** · *~1 day*
- Create `ComingUpCard.vue`, `NeedsYouCard.vue`, `RecentConversationsCard.vue` (mostly lifted from
  today's `HomeView.vue` markup); relative-time schedule copy; final responsive grid; idle-state
  breathing; `data-reduced-motion` wiring from `GET /users/me/preferences`.

**Slice 5 — Weather widget + preference keys** · *~1 day*
- Modify `packages/core/src/users/get-user-preferences.ts` + `set-user-preferences.ts` types +
  `apps/local-api/src/routes/users/schemas.ts` (new keys) + tests; `pnpm api:generate`.
- Create `components/home/widgets/WeatherWidget.vue`, `use-weather.ts` (open-meteo fetch +
  localStorage cache), `weather-codes.ts` + test, inline place-setup via geocoding + `PATCH`
  preferences.

**Slice 6 — News widget + feed proxy** · *~1 day*
- Create `apps/local-api/src/routes/widgets/index.ts` (+ test) — allowlisted passthrough; mount in
  `app.ts`; `pnpm api:generate`.
- Create `components/home/widgets/NewsWidget.vue`, `parse-rss.ts` (+ fixture test), feed
  management in the tile, degradation states.

No other new endpoints: sessions, delegations, approvals, schedules, tasks, usage, and the SSE
feed all ride existing surfaces.

---

## 6 · RISKS & TASTE GUARDRAILS

- **The dashboard-cockpit trap.** The moment Home reads as "metrics", trust inverts — a
  non-technical user sees complexity, not competence. Rules: no counters that exist to be
  counters, no charts, at most **one** gold element animating per card, sentences not stats
  ("Noah is reading your March statement", never `Read(march-statement.pdf) 2.3s`).
  `displayToolName` + the presenter verbs are the vocabulary floor; raw tool ids never render
  here.
- **Narration jitter.** Tools settle in sub-second bursts; a flickering line reads as *nervous*.
  The 800 ms coalesce in Slice 1 is a hard requirement, not polish.
- **Celebration inflation.** The check-draw fires only on a *transition observed while the view is
  mounted* — never on initial load, never replayed on refetch (the snapshot-diff guard). A
  dashboard that celebrates stale work once per visit trains the user to ignore it.
- **Widget creep.** Weather + news + clock is the ceiling until Chad asks otherwise. Every
  additional widget dilutes the actual product ("what is Claude doing for me"). Widgets sit in one
  rail, visually quieter (no gold, ever — outside data must not wear presence).
- **Idle motion.** If the user leaves Home open on a second monitor, nothing may loop except the
  presence dot's slow breathe. Anything faster turns the fireplace into a casino.
- **Feed-drop honesty.** When the SSE feed reconnects, `resetServerTurns` empties the map
  (`use-session-activity-feed.ts:84`) — cards must exit through the same graceful path as
  turn-end, not blink out mid-breath; the 2 s linger absorbs this.
- **Privacy at a glance.** Narration shows *small* inputs by design (2 048-char producer bound) —
  additionally clamp rendered arguments to one line, no file contents, no prompt text: this screen
  may be visible during screen-shares.

---

### Critical files for implementation

- `apps/local-web/src/views/HomeView.vue` — the view being reinvented (becomes grid + composition)
- `apps/local-web/src/composables/activity/use-session-activity-feed.ts` — the one SSE
  subscription every live tile taps (narration fold + invalidations land here)
- `apps/local-web/src/stores/desktop-activity-fold.ts` — the proven fold pattern the new
  turn-narration store clones
- `apps/local-api/src/routes/dashboard/index.ts` — the overview aggregate feeding
  tasks/schedules/workspaces tiles
- `packages/core/src/users/get-user-preferences.ts` — the preference whitelist the widget keys
  extend
