// Test-only helpers for consumers of `@vynel/approvals` — reached through the
// `@vynel/approvals/test-support` subpath so the package's PUBLIC surface
// keeps its one write door (`recordApprovalRequest`, which co-commits the
// outbox event). A raw row insert is a fixture, not an operation.
// (The `packages/providers/src/test-support/` precedent.)

export { insertApprovalRequest } from '../repositories/index.js'
