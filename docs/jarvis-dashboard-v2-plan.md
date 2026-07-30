# Jarvis Dashboard v2 — Global Home + Workspace Overview

**Design + implementation plan · 2026-07-31 · supersedes the unbuilt tail (slices 3–6) of
`docs/jarvis-home-dashboard-plan.md`; slices 1–2 of that plan are BUILT and stay.**

Chad's brief: a beautiful, powerful, Jarvis-grade dashboard. Realtime activity, small helpful
widgets, an at-a-glance overview of everything happening in the user's Vynel. **Two scopes:**
the **global Home** pulls across all workspaces; each **workspace gets its own dashboard**
scoped to that workspace only.

Everything below was verified against the live API surface (route-by-route inventory,
2026-07-31). The taste guardrails from the v1 plan still govern: gold = presence only,
sentences not stats, celebration without confetti, idle screens allowed to be boring.

---

## 1 · What already exists (do not rebuild)

- **Live "Right now" band** — one gold-breathing card per in-flight turn, persona-labeled
  ("Noah · Invoices"), tool-step narration in plain words, origin notes ("via Telegram",
  "from a schedule"). `components/home/LiveNowBand.vue`, `LiveSessionCard.vue`,
  `stores/turn-narration-store.ts`, fed by the app-wide `/activity/stream` SSE subscription.
- **Task celebration** — `TasksCard.vue` with the snapshot-diff guard + FLIP glide to the
  "delivered" shelf.
- **HomeView cards** — recent conversations, workspaces (name + manager line), coming up
  (schedules), approvals (count-only text note).

What's *poor* about today's Home: the cards below the band are thin text lists, approvals is
a sentence instead of actionable rows, nothing shows journal / usage / channels / delegated
work, workspace cards carry no life (no activity, no color, no counts) — and the workspace
view has **no dashboard at all** (chat only).

---

## 2 · Unused data the API already serves (the discovery)

Verified endpoints no dashboard touches today:

| Feed | Endpoint | Dashboard use |
|---|---|---|
| Daily journal (global spans all workspaces) | `GET /journal?entryDate=` / `GET /workspaces/:id/journal` | "Today" narrative card — what the assistant did, in its own words |
| In-flight delegations | `GET /root/delegations` (rows carry `workspaceId`) | "Being worked on" chips: task label + workspace + Watch |
| Pending asks | `GET /asks/pending` | "Needs you" alongside approvals — questions waiting for answers |
| Approval rows + history | `GET /approvals/pending`, `GET /workspaces/:id/approvals/recent` | Real actionable rows, not a count sentence |
| Per-session context occupancy | `GET /sessions/overview` (`contextTokens`/`contextWindow`, rows carry `workspaceId`) | "Room for thought" rings (v1 slice 3, still wanted) |
| Session token totals | `chat sessions.totalInputTokens/totalOutputTokens` | Plain-language usage line (no cost — no pricing layer exists, by design) |
| Channel health | `GET /channels` (`connectionStatus`, `lastInboundAt`) | Quiet health strip: "Telegram connected · last message 2h ago" |
| Knowledge status | `GET /workspaces/:id/knowledge/status` (7 counts + `lastIndexedAt`) | Workspace "what I've read" tile |
| Memory recency | `GET /workspaces/:id/memory/entries` (ordered by `lastMentionedAt`) | Workspace "what I remember" tile — recently recalled facts |
| Files activity | `GET /workspaces/:id/files/activity` | Workspace "recently changed files" feed |
| Skills health | `GET /workspaces/:id/skills/installed` (`installHealth`) | Workspace tile badge when something needs repair |
| Schedule run history | `GET …/schedules/:id/runs` (`status`, `statusMessage`) | "Coming up" gains last-run truth: "last ran ✓ this morning" |
| Plans | `GET /plans` / workspace twin | Today's plan items beside tasks |

Realtime: `/activity/stream` events all carry `workspaceId` — the same feed drives both
scopes with a client-side filter. No new SSE needed.

**The one API gap:** `GET /dashboard/overview` is global-only with no workspace variant.
Memory/knowledge/files are workspace-only with no global variant (fine — global Home
doesn't need them; workspace dashboard uses them directly).

---

## 3 · GLOBAL HOME — layout

Everything, every workspace, one glance. The room where the whole household staff reports.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Good morning, Chad                                          ✳ (mark)        │
│  ● Two sessions working · 1 approval + 1 question waiting                    │
├──────────────────────────────────────────────────────────────────────────────┤
│  RIGHT NOW (exists — unchanged)                     [only while work runs]   │
│  ┌ ◉ Noah · Invoices — reading march-statement.pdf ┐ ┌ ◉ Assistant thread ┐ │
├──────────────────────────────────────────────────────────────────────────────┤
│  NEEDS YOU  (only when non-empty — replaces the approvals sentence)          │
│  ⚠ Approve: send email “March invoices” · Invoices        [Review] [chips]   │
│  ? Noah asked: which logo variant?                          [Answer]         │
├──────────────────────────────┬───────────────────────────────────────────────┤
│  YOUR WORKSPACES (hero grid) │  TODAY                                        │
│  ┌─────────────┐┌──────────┐ │  journal, newest first, assistant's words:    │
│  │◉ Invoices   ││ Research │ │  · Sent the March invoices to all clients     │
│  │ Noah        ││ Mia      │ │  · Booked the dentist for Tuesday             │
│  │ working now ││ 2 tasks  │ │  · Renewed the domain                         │
│  │ 3 open      ││ quiet    │ │                                               │
│  └─────────────┘└──────────┘ │  ON THE LIST (exists: TasksCard, all scopes)  │
│   accent = workspace color   │  ○ Draft pricing page      in progress ◌      │
│   gold dot = live turn       │  ✓ Sent March invoices     just now ⇣ glides  │
├──────────────────────────────┼───────────────────────────────────────────────┤
│  COMING UP                   │  ROOM FOR THOUGHT                             │
│  ◷ Morning briefing          │  ◔ Global chat — about ⅓ full                 │
│    tomorrow 8:00 · repeats   │  ◔ Invoices — nearly fresh                    │
│    last ran ✓ this morning   │  “continues automatically when full”          │
├──────────────────────────────┴───────────────────────────────────────────────┤
│  CONNECTED   ✈ Telegram · connected · last message 2h   🎙 Voice · ready     │
│  RECENT CONVERSATIONS (exists — kept, quieter)                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

The upgrades, piece by piece:

1. **Workspace hero cards** (the centerpiece of "powerful"). Today's workspace card is two
   text lines. It becomes a real card: workspace accent color (`workspaceColorSlot` →
   `--ws-*` tokens), persona name, live state line resolved in priority order —
   *"Noah is working right now"* (gold dot, from `activity.serverTurns` filtered by
   `workspaceId`) → *"2 tasks in hand"* (open/in-progress counts) → *"All caught up"*.
   Click opens the workspace. This is the bridge between the two dashboard scopes.
2. **Needs You** replaces the approvals sentence: real pending-approval rows (tool name via
   `displayToolName`, workspace label, Review button focusing the existing
   `ApprovalNotifier` flow) **plus pending asks** from `GET /asks/pending`. The section
   renders only when non-empty — absence is the good state.
3. **Today** — the journal card. `GET /journal?entryDate=<today>` (spans global + all
   workspaces), assistant-source entries as a quiet narrative list with workspace chips.
   This is the most Jarvis element on the page: the assistant's own account of the day.
   Empty state: "Nothing logged yet today."
4. **Coming up** gains truth: relative-time copy ("tomorrow 8:00") + last-run status from
   the runs endpoint ("last ran ✓ this morning" / "⚠ last run failed" → click-through).
5. **Room for thought** — v1 slice 3, unchanged: `ContextRing` per recently-active
   conversation off `useSessionsOverview`, plain words, never "tokens" on screen.
6. **Connected** — one quiet strip from `GET /channels`: kind + `connectionStatus` in plain
   words + `lastInboundAt`. Healthy = muted; only unhealthy earns the attention color.
7. **Delegated work** — in-flight delegations (`GET /root/delegations`, already polled by
   `use-in-flight-delegations`) render as chips under the Right-now band: "working on:
   *send March invoices* · Invoices · Watch". (Today only the status bar shows these.)

Weather/news widgets (v1 slices 5–6) stay in the plan as the final slice — outside data,
one rail, never gold.

---

## 4 · WORKSPACE OVERVIEW — the new dashboard (biggest new piece)

Every workspace gets an **Overview** — same design language, everything filtered to that
workspace, plus the three surfaces only workspaces have: memory, knowledge, files.

**Where it lives:** a new `overview` entry at the **top** of the workspace drawer sections
(`workspace-sections.ts`), rendered in the section panel like `skills`/`journal` are today.
The chat thread stays the workspace's landing view — Vynel is conversation-first, and the
`WorkspaceWelcomeHero` already owns the empty-workspace moment. (Trade-off noted: making
Overview the landing page demotes chat; recommend not, easily flipped later.)

```
┌────────────────────────────────────────────────────────────────────┐
│  Invoices · Noah                            ● working right now    │
│  "reading march-statement.pdf"        ← live narration when active │
├───────────────────────────────┬────────────────────────────────────┤
│  ON THE LIST (workspace tasks │  TODAY HERE (workspace journal)    │
│  + today's plan items)        │  · Sent the March invoices         │
├───────────────────────────────┼────────────────────────────────────┤
│  WHAT I REMEMBER              │  WHAT I'VE READ                    │
│  recently recalled memories   │  12 documents indexed ✓            │
│  (lastMentionedAt order)      │  2 still reading · updated 3h ago  │
│  “Chad prefers Tuesday calls” │  (knowledge/status counts)         │
├───────────────────────────────┼────────────────────────────────────┤
│  RECENT FILE CHANGES          │  COMING UP (workspace schedules)   │
│  ✎ pricing-draft.md · 2h      │  ◷ Weekly review · Fri 17:00       │
├───────────────────────────────┴────────────────────────────────────┤
│  RECENTLY DECIDED (approvals/recent) · quiet audit trail           │
│  ✓ you approved “send email” · 2h    ✗ you declined “delete” · 1d  │
└────────────────────────────────────────────────────────────────────┘
```

Scoping rules (all verified):

- **Dual-mounted twins** — tasks, plans, schedules, journal, channels, monitors,
  approvals/pending: just call the `/workspaces/:id/…` variant. No new params.
- **Workspace-only surfaces** — memory (`lastMentionedAt`-ordered entries), knowledge
  (`/status` counts), files (`/activity`), skills (`installHealth`), approvals/recent:
  direct calls, these are the workspace dashboard's exclusive tiles.
- **Live turns** — same `/activity/stream` store, filtered `turn.workspaceId === id`
  (the `ProcessingBanner` precedent at `WorkspaceView.vue:73-77`).
- **Header presence** — persona + live narration reuses the turn-narration store; the
  workspace header *is* a LiveSessionCard when a turn runs there.

**API work (the one new endpoint):** `GET /workspaces/:workspaceId/dashboard/overview` —
workspace twin of the existing aggregate, one round-trip:
`{ openTasks, todayPlanItems, upcomingSchedules, todayJournal, knowledgeStatus,
recentMemories (limit 5), recentFileActivity (limit 5), recentApprovals (limit 5),
skillsNeedingAttention }`. Pure assembly of existing package ops (the
`dashboard/index.ts` precedent — no new queries, no schema changes). Locked Hono protocol,
no `x-mcp` (UI-only read).

---

## 5 · BUILD SLICES — ordered, independently shippable

Each slice ships colocated tests + passes `pnpm test`. New components in
`components/home/` (global) and `components/workspace/overview/` (workspace).

**Slice U — Usage statistics (Chad's addition) · ✅ BUILT 2026-07-31**
- Per-model per-local-day token statistics on both dashboards. Core:
  `packages/chat/src/repositories/chat-usage.ts` (assistant rows joined to the
  session model) + `usage/fold-daily-model-usage.ts` (pure fold) +
  `listDailyModelUsage` op. Routes: `GET /dashboard/usage` +
  `GET /workspaces/:id/dashboard/usage` (both clamped 1–90 days, default 30).
  UI: `components/home/UsageStatsCard.vue` (stacked bars per day segmented by
  model, week/2-weeks/month toggle, CSS-only tooltip with in/out split,
  legend, validated `--chart-1..4` tokens both themes), fed by
  `use-usage-stats` (workspaceId-aware — the workspace overview reuses it in
  Slice D). Turn-ended now invalidates `dashboardKeys.all`. Honest labeling:
  input counts include cached context (per-message inputTokens = occupancy);
  no cost figures — no pricing layer exists.

**Slice A — Global "Needs you" + delegation chips** · ~1 day
- `NeedsYouCard.vue`: pending approvals rows (`usePendingApprovals` already polls +
  feed-invalidates) + pending asks (`GET /asks/pending`, new tiny composable).
- Delegation chips under the live band (`use-in-flight-delegations`, already exists).
- Delete the approvals text-note card.

**Slice B — Workspace hero cards + Today (journal)** · ~1.5 days
- `WorkspaceHeroGrid.vue` + `WorkspaceHeroCard.vue`: accent, persona, live-state line
  (needs per-workspace open-task counts → add `openTaskCountByWorkspaceId` to
  `/dashboard/overview`, an assembly-only change).
- `TodayCard.vue`: `GET /journal?entryDate=today`, workspace chips, newest-first.

**Slice C — Room for thought + Coming-up truth + Connected strip** · ~1 day
- `UsageCard.vue` (v1 slice 3 as specced: `useSessionsOverview` + `ContextRing`).
- Coming-up: relative time + last-run status (runs endpoint, limit 1 per schedule —
  or add `lastRunStatus` to the overview serializer if N+1 reads poorly).
- `ConnectedStrip.vue`: `GET /channels`, plain-words health.

**Slice D — Workspace overview endpoint + view** · ~2.5 days (the big one)
- API: `routes/dashboard/workspace-scoped.ts` + schemas + tests; `pnpm api:generate`.
- `overview` section id + `WorkspaceOverviewPanel.vue` composing the tiles; header
  presence via the narration store; memory/knowledge/files/approvals tiles.
- Drawer entry at top; section renders in the existing `WorkspaceSectionPanel` slot.

**Slice E — Grid polish + idle breathing + reduced-motion wiring** · ~0.5 day
- Final responsive grid both scopes, `data-reduced-motion` from user preferences
  (dual-gate: media query AND stored pref), idle-state pass.

**Slice F — Outside widgets (weather + news)** · ~2 days · *unchanged from v1 slices 5–6*
- Preference keys (`homePlace`, `newsFeedUrls`, `homeWidgets`), Open-Meteo weather tile,
  RSS proxy route (allowlisted) + news tile. Widgets rail, never gold, degrade silently.

Order rationale: A/B/C are pure-frontend wins on existing endpoints (fast visible payoff);
D is the structural piece; F last because outside data dilutes focus until the core sings.

---

## 6 · Taste guardrails (carried forward + new)

All v1 guardrails hold (no cockpit, no counters-for-counters, 800ms narration coalesce,
celebration only on observed transitions, widgets never gold, idle = still). New ones:

- **Two scopes, one language.** The workspace overview is the *same* design system zoomed
  in — same card anatomy, same motion tokens. It must feel like walking from the lobby
  into a room, not into a different app.
- **Health is quiet until it isn't.** Channels/skills/knowledge tiles render muted when
  healthy; only a real problem earns the attention color. No green checkmark farms.
- **The journal is the voice.** "Today" renders assistant journal entries verbatim — no
  paraphrasing layer. If entries read poorly, fix the journal-writing prompt, not the UI.
- **No cost theater.** There is no pricing layer; never invent a dollar figure. Usage is
  occupancy in plain words, nothing else.
- **Approval rows are read-only launchers.** Review/Answer buttons focus the existing
  ApprovalNotifier / asks flows — never a second approval surface with its own state.

---

### Critical files

- `apps/local-web/src/views/HomeView.vue` — global grid recomposition
- `apps/local-web/src/components/workspace/workspace-sections.ts` — the `overview` slot
- `apps/local-api/src/routes/dashboard/index.ts` — precedent + counts extension; new
  workspace-scoped twin lands beside it
- `apps/local-web/src/composables/activity/use-session-activity-feed.ts` — the one SSE
  subscription both scopes tap (already wired)
- `apps/local-web/src/stores/turn-narration-store.ts` — narration reuse in workspace header
