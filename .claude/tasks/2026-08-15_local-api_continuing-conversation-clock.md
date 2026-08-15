# Task: Report the continuing conversation's clock
**Plan:** [[nodes-screen-pull]]
**Project:** local-api
**Created:** 2026-08-15
**Status:** completed (2026-08-15)

## Objective

`GET /workspaces/{workspaceId}/chat/continuing` currently returns only
`{ rootSessionId, currentSdkSessionId }`. The Nodes screen needs a third field: **when that
conversation last spoke**.

Without it, a project that has been chatting but never planned steps reads as `idle` grey on the
constellation, because `useWorkspaceProgress` derives "last worked at" purely from the todo dock.
Chad's own note: *"CHATTING is working too — the conversation's own newest-message clock counts
alongside the step dock, so a room that talked without planning steps still reads as running."*

The route already resolves the primary conversation; this adds one read of that conversation's
current session row for its `lastMessageAt`. `findChatSessionById` is already exported from
`@vynel/chat/repositories` and already imported elsewhere in this app — no new plumbing.

**No schema change.** `chatSessions.lastMessageAt` is an existing notNull column.

## Files Involved

- `apps/local-api/src/routes/chat/schemas.ts` — add `lastMessageAt` to
  `ContinuingConversationResponseSchema`
- `apps/local-api/src/routes/chat/index.ts` — resolve the current session, return its clock
- `packages/contracts/src/chat/chat-http.ts` — add the field to `ContinuingConversationResponse`
- `apps/local-api/src/routes/chat/index.test.ts` — pin both readings (null before the first turn,
  the session's clock after)
- `packages/sdk/src/generated/**` — regenerated, never hand-edited
