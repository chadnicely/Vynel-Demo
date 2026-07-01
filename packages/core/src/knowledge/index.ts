// Re-export of the `knowledge` domain. The implementation now lives in the leaf
// package `@vynel/knowledge` (Track B feature-package extraction, 2026-06-28).
// This shim keeps existing `@vynel/core/knowledge` importers unchanged; new code
// imports `@vynel/knowledge` directly. Same playbook as `@vynel/errors`.
// See .claude/ceo/restructure/track-b-plan.md.
export * from '@vynel/knowledge'
