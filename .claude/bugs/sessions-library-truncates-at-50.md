# The Sessions library silently truncates at 50 conversations

**Status:** open
**Kind:** latent-defect
**Area:** `packages/session` (overview) → the Sessions view + the menu's `Sessions N`
**Opened:** 2026-08-15 (surfaced by the section-counts reviewer gate)

## Symptom

Past 50 conversations, the Sessions library shows the 50 most recent and says nothing about
the rest — no "showing 50 of N", no paging, no scroll-to-load. Older conversations are simply
unreachable from the UI.

The menu's `Sessions N` count inherits the same ceiling (by design — see below).

## Root cause

`packages/session/src/overview/get-sessions-overview.ts:133-136` builds every entry, sorts
newest-first, then slices:

```ts
const cap = Math.min(input.limit ?? DEFAULT_ENTRY_LIMIT, MAX_ENTRY_LIMIT) // 50, max 100
return entries.sort(…).slice(0, cap)
```

Neither caller passes a limit, so both take the 50 default:

| surface | call | limit |
|---|---|---|
| Sessions view | `vynel.sessions.overview()` → `routes/sessions/index.ts:81` | none → 50 |
| Menu count | `getSessionsOverview(db, { userId })` → `routes/section-counts/count-sections.ts` | none → 50 |

Upstream, `listAllChatSessionsForUser` caps at 500 ROWS
(`packages/chat/src/repositories/chat-sessions.ts`, `OVERVIEW_LIST_LIMIT`) — a second, looser
ceiling underneath the entry cap.

## What is NOT wrong

The count does not disagree with the list. Both call the same function with the same default,
so they truncate identically — the invariant the section-counts arc is built on holds. **Do not
"fix" this by giving the count its own limit**; that reintroduces exactly the drift that made
the Global menu read `Sessions 5` beside a list of 2 (fixed in `c5ce578`).

One subtlety: the slice happens BEFORE the scope filter, across all scopes. With >50
conversations skewed towards workspaces, the Global row reads low — and the Global Sessions
view shows that same low number. Consistent, both understated.

## Why deferred

It needs a product decision, not a patch: paging, infinite scroll, a raised cap, or an honest
"showing 50 of N" line. Picking one is a UX call, and the arc that surfaced it was a pixel-parity
pass with no mandate to redesign the library.

## The fix, when we take it

Raise or page it **in `getSessionsOverview`** — one place, and both the view and the count follow
for free. If paging, the count needs a real total (a `countSessionsForScope` over the same
predicate as `selectSessionsForScope`) rather than the page length.

## Reproduce

Seed 60+ listed, non-archived conversations for one user, then open `/sessions`: exactly 50 rows,
no indication of more. `curl -s localhost:18892/sessions/overview | jq length` → 50.
