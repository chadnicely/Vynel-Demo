// Repository barrel for the `files` domain. Required by the `@vynel/db`
// package.json `exports` map (`./repositories/*` →
// `./src/repositories/*/index.ts`) so external consumers can import via
// `@vynel/db/repositories/files`. structure-standard.md "Universal
// rules" describes the ≥3-files rule of thumb; the exports map makes the
// barrel mandatory regardless of file count.
export * from './file-activities.js'
