# Todo: Report the continuing conversation's clock
**Task:** [[2026-08-15_local-api_continuing-conversation-clock]]
**Plan:** [[nodes-screen-pull]]
**Project:** local-api

## Steps

- [x] Add `lastMessageAt: z.string().nullable()` to `ContinuingConversationResponseSchema`
- [x] Add `lastMessageAt: string | null` to the `ContinuingConversationResponse` contract, with a
      WHY comment (chatting counts as working)
- [x] In the `/continuing` route: read the primary's current session via `findChatSessionById` and
      return its `lastMessageAt`; update the route's response description
- [x] **Swept and fixed a second caller** — `routes/root/index.ts` (`root.getContinuing`, the GLOBAL
      root conversation) shares the same `ContinuingConversationResponseSchema`. Adding the field to
      the schema without adding it there would have made the generated SDK type lie: declared
      `string | null`, `undefined` on the wire. Both routes now return the same shape.
- [x] Extend `index.test.ts` — null when no conversation exists, null when a primary has no segment
      linked, the session's ISO clock when it does; `root/index.test.ts` updated for the same shape
- [x] Regenerate the SDK (`pnpm api:generate`) — `lastMessageAt: string | null` confirmed in
      `packages/sdk/src/generated/api.d.ts`
- [x] Targeted verify: typecheck clean across local-api + contracts + sdk; **44 tests pass**

## Outcome

Green. No schema migration — `chatSessions.lastMessageAt` was already a notNull column.
