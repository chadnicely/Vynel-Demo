// Drizzle-kit config for the HUB's Postgres schema — the cloud second system
// (docs/module-notes/cloud-api.md §2), fully separate from the product's
// `drizzle.sqlite.config.ts`. Every cloud schema file registers HERE; the
// parity guard (scripts/src/generators/check-schema-parity.ts) requires each
// on-disk schema file to appear in exactly one drizzle config.
//
// Invocation: `pnpm --filter @vynel/cloud-db exec drizzle-kit generate
// --config=../../drizzle.cloud-postgres.config.ts`. CWD is packages/cloud-db;
// paths are relative to it (drizzle-kit on Windows mishandles absolute paths).

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  casing: 'snake_case',
  schema: [
    './src/schema/accounts/accounts.ts',
    '../accounts/src/schema/refresh-tokens.ts',
    '../accounts/src/schema/account-action-tokens.ts',
  ],
  out: './migrations-postgres',
})
