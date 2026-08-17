# The Sessions library silently truncates at 50 conversations

**Status:** FIXED 2026-08-17 — Kafi chose infinite scroll; see Resolution.
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

---

## Resolution

Fixed 2026-08-17 (`36c9aae`). Kafi picked **infinite scroll** from the four
options this file listed.

Taken where the file said to take it — in `getSessionsOverview`, so the view
and the count follow from one place. The file also predicted the count would
need a real total, and it did: `countSessionsOverview` shares the chain fold
and the scope predicate with the list, so the badge and the rows still agree on
what one conversation is (the invariant the section-counts arc rests on) while
the badge is no longer a page length.

**One thing the file did not anticipate.** It warned "do not give the count its
own limit" — right, but the deeper trap was the *scope*. The library filtered
client-side, so paging the shared read would have handed a drilled room a page
of 50 that yielded three rows, and the scroll would have stalled with plenty
left. The scope is now applied server-side BEFORE the cap, which is what makes
a page dense. `selectSessionsForScope` split into `isSessionInScope` so the
view, the count and the paged read all share the predicate.

Also: the library got its own query. `useSessionsOverview` is read by seven
surfaces (statuses, the composer's context ring, the node screen), and they
want the recent-and-capped set, not every conversation. `useSessionStatuses`
now accepts a caller's own entries so a row scrolled in on page three still
lights up — without it, page two would render unlit for exactly the
conversations paging exists to reach.

The subtlety this file called out about the Global row reading low is gone with
it: the scope is applied before the cap, so the count is per-scope and honest.
