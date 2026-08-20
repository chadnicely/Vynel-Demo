# Display — P2, widgets (plan, 2026-08-21)

P1 gave the room. P2 lets Claude put things on it: **widgets** that appear, update and disappear live while the
user watches (or listens). Decisions are Kafi's from `display-research.md` §5 — all accepted: persisted widgets,
12 per scope, named slots, four safe kinds now (`markdown | table | metric | chart`), raw `html` only after CSP
hardening, tools never card, remove/clear as POST routes, one per-user `display` live channel pushed in-process.

## Shape

**Leaf `@vynel/display`** (customization-shaped; leaf rules: kernel + shared only, no sibling leaf imports):
- `schema/display-widgets.ts` — `display_widgets`: `id`, `userId` (kernel FK, cascade), `scopeKey` (`'global'` |
  workspaceId, loose ref), `title` (≤ 80), `kind` (`markdown|table|metric|chart`), `content` (`json<DisplayWidgetContent>`,
  discriminated on kind, ≤ 32 KB serialized), `slot` (`left|stage|right|dock`), `size` (`sm|md|lg`), `sortOrder`,
  `createdBySessionId` (loose, nullable), `expiresAt` (nullable), `createdAt/updatedAt`. Index `(userId, scopeKey,
  sortOrder)`. Registered in `drizzle.sqlite.config.ts`; migration generated (never hand-written) and mirrored into
  the desktop payload.
- `repositories/display-widgets.ts` — functional, `db` first: `findDisplayWidget` (nullable), `listDisplayWidgets(db,
  { userId, scopeKey })`, insert/update/delete/`deleteByScope`, `countByScope`.
- `lifecycle/{add,update,remove,clear}-display-widget.ts` + `queries/list-display-widgets.ts` — every mutation is ONE
  `withTransaction` writing the row(s) AND the outbox event (`create-ask-request.ts:37-60` shape). `add` evicts the
  oldest when the scope holds 12 (the eviction emits its own removed event). Expiry: sweep at boot + lazily on list.
- `display-events.ts` — `display.widget-upserted` / `display.widget-removed` / `display.cleared` (+ payloads).
- `display-live.ts` — `export interface DisplayLiveSink { publish(frame: DisplayLiveFrame): void }` (structural, injected;
  the leaf may not import `@vynel/session`); the frame vocabulary lives in `packages/contracts/src/display/display-live.ts`
  so leaf, hub and client share it.
- Limits as exported consts: `DISPLAY_WIDGET_CONTENT_MAX_BYTES = 32_768`, `DISPLAY_TITLE_MAX_LENGTH = 80`,
  `DISPLAY_MAX_WIDGETS_PER_SCOPE = 12`.

**Content kinds** (`packages/contracts/src/display/display-widget-content.ts`, Zod — one home for route, tool and UI):
- `markdown`: `{ kind: 'markdown', body: string }` — rendered by `MarkdownText.vue` (markdown-it + DOMPurify + shiki).
- `table`: `{ kind: 'table', columns: string[], rows: string[][], caption?: string }` (≤ 12 columns, ≤ 200 rows).
- `metric`: `{ kind: 'metric', value: string, label: string, delta?: string, tone?: 'default'|'attention'|'live'|'muted' }`.
- `chart`: `{ kind: 'chart', type: 'bar'|'line'|'donut', series: { name: string, points: { label: string, value: number }[] }[] }`
  (≤ 4 series — the validated `--chart-1..4` tokens; ≤ 60 points per series). Rendered by our own SVG, no lib.
- `html`: NOT in P2 (gated on CSP work; see research §3).

**API + tools — path A (x-mcp routes), `apps/local-api/src/routes/display/`:**
| route | tool | card |
|---|---|---|
| `GET /display/widgets?scope=` | `display_list_widgets` | never |
| `POST /display/widgets` | `display_add_widget` | never (`mutatingApproved: true`, D7) |
| `PATCH /display/widgets/:id` | `display_update_widget` | never |
| `POST /display/widgets/:id/remove` | `display_remove_widget` | never (POST — DELETE would auto-join the ask tier) |
| `POST /display/clear` | `display_clear` | never |
Surfaces: root (global chat, voice rides root) + workspace-interactive; gate behind a `display` capability (default
on) in `vynel-tool-gates.ts`; `pnpm api:generate` + census + catalog parity. The description is the UX: *"The Display
is a glanceable board beside the conversation — use it when the answer is a report, a table, numbers, or something
the user will keep looking at after this turn (especially on voice). Never instead of answering: say the takeaway
in your reply too. List first and update the matching widget rather than adding a near-duplicate. Four kinds:
markdown, table, metric, chart."* The route handler calls the leaf op and then `displayLiveSink.publish(...)` in
process (the outbox relay's 5 s tick is too slow for "appears as Claude says it"; the outbox row remains the
durable record for any other consumer).

**Live leg:** one per-user `display` channel — `packages/contracts/src/chat/live-channel.ts` (key, parse, server
frame), `live-channel-hub.ts` (a `DisplaySource` beside activity/turn/voice), the exhaustive authorizer switch in
`apps/local-api/src/live/live-channel-route.ts:41` (auth = the user's own), sink wired in `boot.ts` + `factory.ts`.
Client: `apps/local-web/src/composables/display/use-display-widgets.ts` — loads the scope's list via the SDK,
subscribes `display`, patches the cache on upsert/removed/cleared (`use-session-activity-feed.ts` pattern).
`live-channel-store.ts` needs no change (dispatches by `frame.channel`).

**Renderers:** `apps/local-web/src/components/display/{DisplayWidget.vue, DisplayMarkdownWidget.vue,
DisplayTableWidget.vue, DisplayMetricWidget.vue, DisplayChartWidget.vue}`; `DisplayWidget` = the frame (title,
kind glyph, remove ×, size class) + the kind switch. `DisplayView.vue` fills its `left|stage|right` slots from
`use-display-widgets` (scope = the active global/workspace scope — surface decides scope); a "Clear" affordance
calls `/display/clear`. Dark-only, uses the seven `--display-*` vars; charts use `--chart-1..4`.

**Instructions:** one sentence each in `global-root.md` and `voice-turn.md`: on voice, say one sentence and put the
detail on the Display; in chat, the Display is for things worth keeping on screen.

## Slices (sequenced — b and c may run in parallel once a has landed)

| | Owns | Delivers |
|---|---|---|
| **P2a** | `packages/display/**`, `packages/contracts/src/display/**`, `drizzle.sqlite.config.ts`, migration + payload mirror | the leaf, content schemas, events, limits, sink interface — all tested on real SQLite |
| **P2b** | `apps/local-api/src/routes/display/**`, `app.ts` mount, `apps/mcp/src/vynel-tool-gates.ts`, capability catalog entry, generated artifacts, census/catalog tests, the two instruction sentences | routes + tools + gates + steer |
| **P2c** | `live-channel.ts`, `live-channel-hub.ts`, `live-channel-route.ts`, `boot.ts`/`factory.ts` sink, `use-display-widgets.ts` | the push path end to end |
| **P2d** | `apps/local-web/src/components/display/**`, `DisplayView.vue` slot filling, `use-display-status.ts` telemetry line on widget events | the renderers + the room showing them |

Acceptance: in voice, "show me this week's schedule runs as a table" → the table appears on the stage while Vynel is
still talking; "remove it" → gone; a 13th widget evicts the oldest; restart → widgets still there; a
workspace chat puts its widgets on that workspace's Display scope only; none of the four kinds can execute
script or reach the app origin (DOMPurify on markdown; the others are data-only components).
