// Public surface of the cross-cutting `_shared` core utilities. Consumers
// import via `@vynel/core/_shared`. The underscore marks cross-cutting infra,
// not a domain (per structure-standard `_shared/`).

export { dispatchOutboxEvents } from './dispatch-outbox-events.js'
export { OUTBOX_CONSUMERS, type OutboxConsumer } from './outbox-consumer-registry.js'

// Re-export the structural logger so the worker delegator imports it from the
// same package as the op (the channels barrel precedent).
export type { StructuralLogger } from '@vynel/logger'
