// Schema barrel for the `channels` domain. Re-exports every table file so
// `schema/index.ts` can aggregate by domain. Per
// `.claude/rules/structure-standard.md` "packages/db/src/schema/".
export * from './channels.js'
export * from './channel-user-links.js'
export * from './channel-inbound-messages.js'
export * from './channel-message-queue.js'
