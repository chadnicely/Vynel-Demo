// Repository barrel for the `channels` domain. Four sibling repos (channels,
// channel-user-links, channel-inbound-messages, channel-message-queue) ≥ 3
// → barrel required per `.claude/rules/structure-standard.md`
// "packages/channels/src/repositories/". Sibling files may also import a single
// repo via its relative subpath (`./channels.js`) per the namespace-import
// convention in `coding-standard.md` "Imports".
export * from './channels.js'
export * from './channel-user-links.js'
export * from './channel-inbound-messages.js'
export * from './channel-message-queue.js'
export * from './channel-chat-groups.js'
