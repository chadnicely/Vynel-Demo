# sessions/ — the api EDGE of the session tier (deliberately thin)

The session logic itself lives in `@vynel/session` (`./runtime` + `./continuity` +
`./delegation` — see the 2026-07-12 delegation lift, `docs/module-notes/session.md`).
What remains here CANNOT move into a package, each for a live reason:

| file | why it stays at the edge |
| --- | --- |
| `compose-session-mcp-servers.ts` | LOCKED `api-side-turn-execution-with-mcp` decision — core stays below the MCP producers; every consumer is app-side |
| `run-global-root-turn.ts` | dynamically imports `@vynel/mcp` (= `apps/mcp`) — a package may never import an app |
| `global-root-workspace.ts` | reads `../env.js` (`VYNEL_USER_DATA_DIR`) — env access lives only in the app |
| `resolve-global-root-conversation.ts` | composes the env-coupled dir above; it IS the injected `resolveTarget` seam |
| `delegation-{mode,origin}-header.ts` | HTTP wire encoding of orchestration types — a transport concern of this surface |
| `build-schedule-fire-deps.ts` | assembles deps from `../factory.js` — app DI by definition |

Adding a file here needs one of those reasons. Cross-domain session COMPOSITION
(running turns, delegation, trace reads) belongs in `@vynel/session`.
