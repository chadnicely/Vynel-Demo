// The `display` HTTP surface — mounted at `/display` (NO workspace prefix)
// from `apps/local-api/src/app.ts`. The Display is the glanceable board beside
// the conversation; these five routes are how the UI and Claude put things on
// it and take them off:
//
//   GET   /widgets?scope=       -> listDisplayWidgets    [x-mcp: display_list_widgets]
//   POST  /widgets              -> addDisplayWidget      [x-mcp: display_add_widget]
//   PATCH /widgets/:widgetId    -> updateDisplayWidget   [x-mcp: display_update_widget]
//   POST  /widgets/:widgetId/remove -> removeDisplayWidget [x-mcp: display_remove_widget]
//   POST  /clear                -> clearDisplayWidgets   [x-mcp: display_clear]
//
// USER-scoped, never workspace-pathed: one person's boards live side by side
// (`'global'` + one per workspace) and the surface picks which by `scope`. The
// leaf authorizes every read and write by `userId`, so another user's widget is
// indistinguishable from one that never existed — the same 404 either way.
//
// WHY `POST /widgets/:widgetId/remove` and not `DELETE /widgets/:widgetId`:
// the generator auto-joins every DELETE route to the ask-approval tier, so the
// tool would card. Tidying the board is the CHEAPEST act in the product — a
// card asking permission to take a card off a screen costs more attention than
// the card it removes, and on voice there is nobody at the screen to answer it.
// All five stay card class `never` (no DELETE, no `askApproval`) — pinned in
// `session-tool-catalog.test.ts`. Do not "fix" this by matching the schedules
// precedent: schedules fire work later, a widget only draws.
//
// Locked Hono protocol: describeRoute -> validator -> `...userScoped` ->
// handler on `factory.createApp()`; handlers THROW typed VynelError subclasses
// (the app.ts onError maps them). The live push is injected, not imported: the
// handlers pass `c.var.displayLiveSink` (set in `app.ts`, constructed in
// `boot.ts`) as the ops' `deps` — absent, the ops simply publish nothing and
// the outbox row remains the durable record.

import { resolver, validator } from 'hono-openapi/zod'
import { getWorkspaceById } from '@vynel/workspaces'
import {
  addDisplayWidget,
  clearDisplayWidgets,
  listDisplayWidgets,
  removeDisplayWidget,
  updateDisplayWidget,
  type DisplayOpDeps,
} from '@vynel/display'
import type { Database } from '@vynel/db'
import type { DisplayWidgetView } from '@vynel/contracts/display/display-widget'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  AddDisplayWidgetRequestSchema,
  ClearDisplayRequestSchema,
  ClearDisplayResponseSchema,
  DisplayWidgetParamSchema,
  DisplayWidgetResponseSchema,
  ListDisplayWidgetsQuerySchema,
  ListDisplayWidgetsResponseSchema,
  UpdateDisplayWidgetRequestSchema,
} from './schemas.js'

/** The shared steer every Display tool description opens with — the tool
 *  description IS the UX here, and all five must teach the same board. */
const DISPLAY_STEER =
  'The Display is a glanceable board beside the conversation. Use it when the answer is a ' +
  'report, a table, numbers, or anything the user will keep looking at after this turn — ' +
  'especially on voice, where the reply is heard and not read. NEVER instead of answering: ' +
  'say the takeaway in your reply too. '

/** How a caller names a board, repeated in every tool description because the
 *  field cannot be inferred: the routes are user-scoped, so there is no
 *  ambient workspace stamp to fall back on. */
const SCOPE_STEER =
  "scope is 'global' in the global conversation, or this workspace's id in a workspace " +
  'conversation (whoami reports it). '

const CONTENT_STEER =
  'content is one of four kinds: ' +
  "{kind:'markdown', body} · " +
  "{kind:'table', columns:[string], rows:[[string]], caption?} (≤12 columns, ≤200 rows, every " +
  'row exactly as long as columns) · ' +
  "{kind:'metric', value, label, delta?, tone?:'default'|'attention'|'live'|'muted'} · " +
  "{kind:'chart', type:'bar'|'line'|'donut', series:[{name, points:[{label, value}]}]} " +
  '(≤4 series, ≤60 points each). Serialized content is capped at 32 KB. '

/** Self-cleaning boards. Offered on both writes because the moment a card
 *  becomes temporary is often the SECOND time Claude touches it ("this is just
 *  for today after all"). */
const EXPIRY_STEER =
  'expiresAt is optional (ISO-8601, and in the future) — for a card that should clean itself ' +
  "up, e.g. a 'today' panel. Leave it out for a card that stays until someone removes it. "

/** `'global'`, or a workspace id the caller owns. Ownership goes through
 *  `getWorkspaceById` rather than a hand-rolled repo read + compare — that op
 *  already owns the rule (and the deliberate not-found-equals-not-owned 404
 *  that keeps ids un-enumerable); a second copy here would be a second place
 *  for it to drift. */
async function resolveDisplayScopeKey(
  db: Database,
  input: { scope: string; userId: string },
): Promise<string> {
  if (input.scope === 'global') return 'global'
  return (await getWorkspaceById(db, input.scope, input.userId)).id
}

/** The ops' optional live push. Absent (tests, generators, a daemon booted
 *  without the hub) means "publish nothing" — never an error. */
function displayOpDeps(liveSink: DisplayOpDeps['liveSink']): DisplayOpDeps {
  return liveSink === undefined ? {} : { liveSink }
}

export const displayApp = factory
  .createApp()
  // GET /widgets — one board, in presentation order (expired cards swept first).
  .get(
    '/widgets',
    describeRoute({
      tags: ['display'],
      summary: "List one scope's Display widgets, in presentation order.",
      'x-sdk-name': 'display.listWidgets',
      responses: {
        200: {
          description: 'Array of DisplayWidget.',
          content: {
            'application/json': { schema: resolver(ListDisplayWidgetsResponseSchema) },
          },
        },
        404: { description: 'No such workspace owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'display_list_widgets',
        rootSurface: true,
        workspaceInteractiveSurface: true,
        description:
          DISPLAY_STEER +
          'This lists what is ALREADY on the board — call it before adding, and update the ' +
          'matching widget rather than adding a near-duplicate. ' +
          SCOPE_STEER +
          'Read-only.',
      },
    }),
    validator('query', ListDisplayWidgetsQuerySchema),
    ...userScoped,
    async (c) => {
      const scopeKey = await resolveDisplayScopeKey(c.var.db, {
        scope: c.req.valid('query').scope,
        userId: c.var.user.id,
      })
      const widgets: DisplayWidgetView[] = listDisplayWidgets(
        c.var.db,
        { userId: c.var.user.id, scopeKey },
        displayOpDeps(c.var.displayLiveSink),
      )
      return c.json(widgets)
    },
  )
  // POST /widgets — put a card on the board (a 13th evicts the oldest).
  .post(
    '/widgets',
    describeRoute({
      tags: ['display'],
      summary: 'Add a widget to a scope’s Display (the 13th evicts the oldest).',
      'x-sdk-name': 'display.addWidget',
      responses: {
        201: {
          description: 'The widget as it now sits on the board.',
          content: { 'application/json': { schema: resolver(DisplayWidgetResponseSchema) } },
        },
        400: { description: 'Invalid title, slot, size, or content.' },
        404: { description: 'No such workspace owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'display_add_widget',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
        description:
          DISPLAY_STEER +
          'Call display_list_widgets first and prefer display_update_widget on a matching card ' +
          'over adding a near-duplicate. ' +
          SCOPE_STEER +
          CONTENT_STEER +
          // 'dock' rejoined this sentence with P3a, which draws it: the mini
          // Display is one row over the user's other work, so the words have
          // to say what fits there — a card nobody can read in a corner is a
          // card the user never sees either.
          "slot is 'left' | 'stage' | 'right' | 'dock' (default 'stage', the widest region; " +
          "'dock' is the mini Display floating over the user's screen while they work — send " +
          'a single number or one line there, never a table or a chart) and ' +
          "size is 'sm' | 'md' | 'lg' (default 'md'). " +
          EXPIRY_STEER +
          'The board holds 12 per scope: a 13th ' +
          'quietly evicts the oldest, so this never fails for being full.',
      },
    }),
    validator('json', AddDisplayWidgetRequestSchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')
      const scopeKey = await resolveDisplayScopeKey(c.var.db, {
        scope: body.scope,
        userId: c.var.user.id,
      })
      const widget: DisplayWidgetView = addDisplayWidget(
        c.var.db,
        {
          userId: c.var.user.id,
          scopeKey,
          title: body.title,
          content: body.content,
          ...(body.slot !== undefined ? { slot: body.slot } : {}),
          ...(body.size !== undefined ? { size: body.size } : {}),
          ...(body.expiresAt !== undefined ? { expiresAt: new Date(body.expiresAt) } : {}),
        },
        displayOpDeps(c.var.displayLiveSink),
      )
      return c.json(widget, 201)
    },
  )
  // PATCH /widgets/:widgetId — change a card already on the board.
  .patch(
    '/widgets/:widgetId',
    describeRoute({
      tags: ['display'],
      summary: 'Update a Display widget in place (only the fields you pass change).',
      'x-sdk-name': 'display.updateWidget',
      responses: {
        200: {
          description: 'The updated widget.',
          content: { 'application/json': { schema: resolver(DisplayWidgetResponseSchema) } },
        },
        400: { description: 'Invalid title, slot, size, or content.' },
        404: { description: 'No such widget owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'display_update_widget',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
        description:
          DISPLAY_STEER +
          'Update the card already showing this thing instead of adding another one — a live ' +
          'number, a table gaining rows, a status changing. Find widgetId via ' +
          'display_list_widgets. Only the fields you pass change. ' +
          CONTENT_STEER +
          EXPIRY_STEER +
          'A widget cannot move between boards; to put it elsewhere, remove it and add it there.',
      },
    }),
    validator('param', DisplayWidgetParamSchema),
    validator('json', UpdateDisplayWidgetRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const widget: DisplayWidgetView = updateDisplayWidget(
        c.var.db,
        {
          userId: c.var.user.id,
          widgetId: c.req.valid('param').widgetId,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.content !== undefined ? { content: body.content } : {}),
          ...(body.slot !== undefined ? { slot: body.slot } : {}),
          ...(body.size !== undefined ? { size: body.size } : {}),
          ...(body.expiresAt !== undefined ? { expiresAt: new Date(body.expiresAt) } : {}),
        },
        displayOpDeps(c.var.displayLiveSink),
      )
      return c.json(widget)
    },
  )
  // POST /widgets/:widgetId/remove — take one card off (POST, never DELETE; see header).
  .post(
    '/widgets/:widgetId/remove',
    describeRoute({
      tags: ['display'],
      summary: 'Remove one widget from the Display.',
      'x-sdk-name': 'display.removeWidget',
      responses: {
        200: {
          description: 'The widget as it was when removed.',
          content: { 'application/json': { schema: resolver(DisplayWidgetResponseSchema) } },
        },
        404: { description: 'No such widget owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'display_remove_widget',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
        description:
          'Take one widget off the Display — the user said "remove it", or the thing it showed ' +
          'is finished. Find widgetId via display_list_widgets. This only clears a card off a ' +
          'screen; nothing the widget described is deleted.',
      },
    }),
    validator('param', DisplayWidgetParamSchema),
    ...userScoped,
    (c) => {
      const widget: DisplayWidgetView = removeDisplayWidget(
        c.var.db,
        { userId: c.var.user.id, widgetId: c.req.valid('param').widgetId },
        displayOpDeps(c.var.displayLiveSink),
      )
      return c.json(widget)
    },
  )
  // POST /clear — wipe one board in a single stroke (POST, never DELETE; see header).
  .post(
    '/clear',
    describeRoute({
      tags: ['display'],
      summary: 'Clear every widget from one scope’s Display.',
      'x-sdk-name': 'display.clear',
      responses: {
        200: {
          description: 'How many widgets were removed.',
          content: { 'application/json': { schema: resolver(ClearDisplayResponseSchema) } },
        },
        404: { description: 'No such workspace owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'display_clear',
        mutatingApproved: true,
        rootSurface: true,
        workspaceInteractiveSurface: true,
        description:
          'Clear a whole Display board at once — the user said "clear the display", or the ' +
          'subject changed entirely. ' +
          SCOPE_STEER +
          'To take a single card off, use display_remove_widget instead. This only clears cards ' +
          'off a screen; nothing they described is deleted.',
      },
    }),
    validator('json', ClearDisplayRequestSchema),
    ...userScoped,
    async (c) => {
      const scopeKey = await resolveDisplayScopeKey(c.var.db, {
        scope: c.req.valid('json').scope,
        userId: c.var.user.id,
      })
      return c.json(
        clearDisplayWidgets(
          c.var.db,
          { userId: c.var.user.id, scopeKey },
          displayOpDeps(c.var.displayLiveSink),
        ),
      )
    },
  )
