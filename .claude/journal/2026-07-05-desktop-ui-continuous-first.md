# 2026-07-05 — desktop-ui: continuous-first chat reshape (Chad's UX feedback)

## The contract change

Chad's feedback flipped the chat model to match the product's soul: **the chat IS the one
continuous session** — history is opt-in, not the frame.

- Chat + Workspace open directly into the continuous thread (full-width, no panel).
- Titlebar left: menu icon (wordmark removed) + history toggle; workspace adds switcher + "+".
- The menu **replaces the chat area in place** (AppDrawer deleted); "Chat" is a menu item — the
  way back. Workspace menu carries the feature sections; sections render in the main area.
- History panel (toggled): pinned "Current conversation" + past topics.
- Approval notifications moved to **bottom-right**, decidable anywhere.

## The right abstraction appeared

The real API already models this: `GET /workspaces/{id}/chat/continuing` →
`ContinuingConversationResponse`. The demo seam now mirrors it
(`chat.getContinuingConversation(scope)` + `useContinuingConversation`), and demo continuous
threads are `visibility: 'hidden'` like real continuing-root segments — the swap stays honest.

## Mechanics

`ui-store` gained the chat shell state (`ChatTarget` = continuous | fresh | {sessionId};
`ChatMainView` = chat | menu | application | section) per tab, because the titlebar now drives the
views. `SessionsPanel` slimmed (pinned current row; menu/new buttons moved to the titlebar).
`MenuListView` is the shared in-place menu. Verified: 48/48 tests, typecheck, lint, browser sweep
(continuous thread with grouped "Write 2 files" cards on load · history toggle · both menus ·
workspace top-bar order) — zero console errors.
