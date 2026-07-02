# 2026-07-02 — knowledge api (Step A)

**Moved** (git archive from KAFI `refactor/session-library` → KLONE): the api-core (`apps/local-api`:
factory, app, env, server, openapi, index) + middleware (user-resolver, workspace-resolver) +
handler-bundles (user-scoped, workspace-scoped) + `routes/knowledge`; and a **`@vynel/core`
spine-slice** (users, workspaces, errors, knowledge, _shared).

**Gate:** `pnpm install` EXIT 0 · `turbo typecheck` 17/17 · `vitest` 482 passed / 4 skipped (up from 421).

**Trimmed / improved (green faithfully first, per build-discipline):**
- `factory.ts` — dropped `chatSession` + `desktopNotifications` from `AppEnv` (chat/desktop not pulled).
- `app.ts` — mounts only `/workspaces/:workspaceId/knowledge`; dropped the other 17 route imports/mounts,
  the desktop-control option, and the first-launch gate.
- `server.ts` — boots db → migrations → local user → createApp → serve; dropped the provider / desktop /
  channels / schedules / delegation boot services.
- **Deleted** (coupled to un-pulled domains): `middleware/chat-session-resolver.ts` (chat),
  `middleware/first-launch-gate.ts` (`@vynel/core/onboarding`), `handler-bundles/session-scoped.ts`,
  `_shared/dispatch-outbox-events.integration.test.ts` (schedules).
- `_shared/outbox-consumer-registry.ts` — emptied `OUTBOX_CONSUMERS` (channels/schedules consumers
  re-register as those domains land; the dispatch impl + its generic test are unaffected).
- Trimmed `@vynel/core` deps → db/errors/knowledge/logger; `@vynel/local-api` deps → core/db + the hono stack.
- Kept the `@vynel/core/{errors,knowledge}` shims + the api's `@vynel/core/*` imports (faithful; the
  rewire-to-direct-packages is a later polish per CLAUDE.md).

**pnpm 11.0.0 quirk (documented in `pnpm-workspace.yaml`):** only `allowBuilds: <dep>: true` silences the
build-approval gate — `false` and `ignoredBuiltDependencies` do NOT. So every build-script dep is `true`
(onnxruntime/sharp/unrs prebuilts are one-time + cached). **Follow-up:** bump the pinned pnpm to 11.9+ to
cleanly skip unneeded native builds.

**Next:** Step B — the generation pipeline (`scripts/generators` + `@vynel/sdk` + `@vynel/mcp-contract` +
`apps/mcp`): generate the flat SDK + MCP tools from the knowledge route, wire direction ③ (agent-bound
MCP), and prove `pnpm api:generate` + parity.
