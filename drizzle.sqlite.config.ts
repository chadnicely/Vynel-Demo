// Drizzle-kit Phase 1 config. Generates SQLite migrations from the
// `packages/db/src/schema/` tree into `packages/db/src/migrations-sqlite/`.
// Per `.claude/rules/data-standard.md` "Migrations": Phase 1 ships
// SQLite migrations only; the Postgres baseline (in `drizzle.postgres.
// config.ts`) is created when Phase 2 cloud work begins.
//
// Invocation: `pnpm --filter @vynel/db exec drizzle-kit generate
// --config=../../drizzle.sqlite.config.ts`. drizzle-kit runs with
// CWD=packages/db (the filter target); paths below are relative to
// that CWD. drizzle-kit on Windows mishandles absolute paths
// (double-prefixes the CWD), so we keep them relative.
//
// `casing: 'snake_case'` auto-converts JS camelCase property names to
// snake_case SQL column names per `.claude/rules/data-standard.md`
// "Schema".

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  casing: 'snake_case',
  schema: [
    './src/schema/users/users.ts',
    './src/schema/users/user-preferences.ts',
    './src/schema/workspaces/workspaces.ts',
    './src/schema/providers/provider-preferences.ts',
    '../chat/src/schema/chat-sessions.ts',
    '../chat/src/schema/chat-messages.ts',
    '../chat/src/schema/chat-tool-calls.ts',
    '../approvals/src/schema/approval-rules.ts',
    '../approvals/src/schema/approval-requests.ts',
    '../memory/src/schema/memory-entries.ts',
    '../memory/src/schema/memory-entry-mentions.ts',
    '../memory/src/schema/memory-tags.ts',
    '../knowledge/src/schema/sources.ts',
    '../knowledge/src/schema/documents.ts',
    '../knowledge/src/schema/chunks.ts',
    '../skills/src/schema/installed-skills.ts',
    '../skills/src/schema/skill-settings.ts',
    '../marketplace/src/schema/cloud-catalog-cache.ts',
    './src/schema/files/file-activities.ts',
    '../channels/src/schema/channels.ts',
    '../channels/src/schema/channel-user-links.ts',
    '../channels/src/schema/channel-inbound-messages.ts',
    '../channels/src/schema/channel-message-queue.ts',
    '../schedules/src/schema/schedules.ts',
    '../schedules/src/schema/schedule-runs.ts',
    '../tasks/src/schema/tasks.ts',
    '../asks/src/schema/ask-requests.ts',
    '../apps/src/schema/workspace-apps.ts',
    './src/schema/onboarding/onboarding-runs.ts',
    './src/schema/capabilities/workspace-capabilities.ts',
    './src/schema/agents/agents.ts',
    './src/schema/agents/agent-skills.ts',
    '../instructions/src/schema/instruction-documents.ts',
    '../session/src/schema/primary-sessions.ts',
    '../orchestration/src/schema/delegation-jobs.ts',
    './src/schema/_shared/outbox-events.ts',
  ],
  out: './src/migrations-sqlite',
})
