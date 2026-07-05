// The `files` HTTP surface — 10 routes mounted under
// `/workspaces/:workspaceId/files` from `apps/local-api/src/app.ts`:
//
//   GET  /tree           -> listDirectory        (files.tree)
//   GET  /content         -> readFileContent       (files.readContent)
//   PUT  /content         -> writeFileContent      (files.saveContent)
//   GET  /raw             -> streamFileBytes       (files.raw)
//   POST /file             -> createFile            (files.createFile)
//   POST /directory        -> createDirectory       (files.createDirectory)
//   POST /move             -> moveEntry             (files.move)
//   POST /delete           -> deleteEntry           (files.delete)
//   GET  /activity        -> listRecentActivity    (files.listActivity)
//   GET  /activity/file   -> listFileHistory       (files.listFileHistory)
//
// Locked Hono protocol per `coding-standard.md` "Hono routes" +
// `sdk-mcp.md`: each sub-route file uses describeRoute (from the local
// openapi.js wrapper) -> validator (from hono-openapi/zod) ->
// ...workspaceScoped -> handler, chained on factory.createApp(). This
// index composes them via `.route('/', ...)` per the Hono sub-app idiom.
//
// MCP exposure (ported D10, faithful to source): NO route carries
// `x-mcp` — not even the safe-read GETs. The agent already has native
// Claude-Code Read/Glob/Edit/Write tools over the workspace; exposing
// an equivalent MCP surface here would be redundant (the same
// "redundant with an existing surface" rationale as marketplace's D9).
//
// Split from a single file per Gate-3 C2 (structure-standard.md
// "Universal rules / File size cap").

import { factory } from '../../factory.js'
import { activityRoutes } from './activity.js'
import { contentRoutes } from './content.js'
import { mutationRoutes } from './mutations.js'
import { rawRoutes } from './raw.js'
import { treeRoutes } from './tree.js'

export const filesApp = factory
  .createApp()
  .route('/', treeRoutes)
  .route('/', contentRoutes)
  .route('/', rawRoutes)
  .route('/', mutationRoutes)
  .route('/', activityRoutes)
