# 2026-07-09 — Claude identity polish + channel-origin badges

Two commits: `7159d3b` (the chat-polish round) · `a8c51b5` (origin badges).

## What shipped

Chad's direction on the chat surfaces, landed in one day: the assistant is **Claude** by name with
the coral `ClaudeMark` spark (identity-only token; gold stays presence-only), the welcome hero +
command deck, no chrome over a flowing thread (he explicitly killed the identity bar — twice: the
strip AND its richer replacement), Discord-model scrolling with a windowed newest-100 history,
Claude-Code-style tool cards, workspace rooms wearing their manager persona, and per-message
channel-origin badges ("via Voice").

## Learnings

- **Chad reviews by screenshot with a red pen — ship, screenshot, iterate.** His circled "we don't
  need extra stuffs" killed a bar the previous reviewer had blessed. Taste rules extracted to
  memory [[assistant-is-claude-not-vynel]]: no persistent chrome over a thread; tool calls must
  look like Claude Code's own UI; the assistant is Claude, unbranded.
- **The first incremental migration happened here** (`0001_chat-message-origin-channel.sql`).
  Baseline-folding is over: Chad has real conversation history now, and `node --watch` means the
  running API applies a new migration the moment the file lands. drizzle-kit generate against the
  root config worked cleanly (`pnpm --filter @vynel/db exec drizzle-kit generate
  --config=../../drizzle.sqlite.config.ts --name=<slug>`).
- **The origin signal already existed** — `/root/turn`'s `voice: true` (added for the spoken-style
  directive) was the voice-origin fact all along; persisting it was a passthrough, not a new
  protocol. Check for an existing signal before designing a new one.
- **Mount-with-preloaded-data breaks growth watchers.** ThreadStream mounts behind a `v-if` on the
  fetched messages, so `watch(messages.length)` never fires for the initial fill — the thread
  opened at the TOP. Found only by driving the real app (Playwright); fixed with an explicit
  onMounted bottom-anchor. Unit tests can't catch this class; live smoke can.
- **A reviewer guard can regress the motivating case.** The "don't drop tool output" guard on the
  single-string-input presentation made `speak` (whose output is a boilerplate ack) fall back to
  JSON panes — the exact ugliness the change existed to fix. Caught by re-running the live check
  after applying review fixes; resolved with an explicit, commented speak special-case.
- **Playwright route-patching** (`route.fetch()` → mutate JSON → `fulfill`) is a fast way to
  preview a UI state the DB can't produce yet (the badge before any stamped row existed).

## Open with Chad

- Does "no vynel anywhere" cover the PRODUCT name (onboarding wordmark, "Vynel Jarvis" window
  titles, tab title)? Assistant-copy is swept; product-branding awaits his call.
- Next polish candidates spotted: workspace sections drawer (Channels = bare header, no connect
  flow), voice overlay (ignores Escape; caption/error overlap), hero Voice chip could read live
  daemon status.
