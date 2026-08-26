// Tests for the generated namespaced SDK facade — a golden-shape canary
// (namespace tree + method names match the routes' `x-sdk-name`), the
// runtime ergonomic (returns the body on 2xx, throws `SdkError` on
// non-2xx), and the request shaping the emitter produces (path params +
// the optional-vs-required query split). Shape drift → re-run
// `pnpm api:generate`; the CI parity guard
// (`scripts/src/generators/check-sdk-parity.ts`) is the wider net.

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { Client } from 'openapi-fetch'
import { makeNamespaced } from './namespaced.js'
import { SdkError } from '../errors.js'
import type { paths } from './api.js'

// `makeNamespaced` references `client` only inside the method closures
// (never at build time), so a bare stub suffices for shape assertions.
const stubClient = {} as unknown as Client<paths>

// The knowledge namespace's methods, sorted (the generator emits
// alphabetically). Grows as more `x-sdk-name` routes land.
const EXPECTED_KNOWLEDGE_METHODS = [
  // renamed from addDirectory when sources gained single-file support —
  // deliberate spec change, 2026-07-11
  'addSource',
  'getDocument',
  'getStatus',
  'listDocuments',
  'listSources',
  'reindex',
  'removeSource',
  'search',
] as const

// The approvals namespace's methods (the global-queue surface), sorted.
const EXPECTED_APPROVALS_METHODS = ['decide', 'listPending'] as const

// The channels namespace's methods, sorted. The 2 read GETs (list /
// listAllowedSenders) + the 7 mutating lifecycle/allowlist routes all carry
// `x-sdk-name`; x-mcp is the narrower opt-in (only the 2 GETs are exposed —
// connect carries the bot token and is never an MCP tool).
const EXPECTED_CHANNELS_METHODS = [
  'addAllowedSender',
  'connect',
  'disable',
  'disconnect',
  'enable',
  'history',
  'list',
  'listAllowedSenders',
  'removeAllowedSender',
] as const

// The channelsUser namespace's methods, sorted — the USER-scoped `/channels`
// surface (a user's global + workspace channels alike). Full lifecycle, distinct
// top namespace from the workspace-scoped `channels.*` (no x-sdk-name collision).
// Only `list` (list_my_channels) is x-mcp; connect carries the bot token.
const EXPECTED_CHANNELS_USER_METHODS = [
  'addAllowedSender',
  'approveGroup',
  'connect',
  'disable',
  'disconnect',
  'enable',
  'get',
  'history',
  'ignoreGroup',
  'list',
  'listAllowedSenders',
  'listGroups',
  'removeAllowedSender',
  'rename',
  'setGroupPolicy',
] as const

// The skills namespace's methods, sorted. The 3 read GETs + the 4
// mutating lifecycle/settings routes all carry `x-sdk-name` (x-mcp is a
// separate, narrower opt-in). No enable/disable pair — skills are
// install/uninstall-only (2026-08-01). `listInstalled` is what this
// workspace OWNS (the menu, mirroring disk); `listInstalledResolved` is
// what a session there can reach, user ∪ workspace — the "/" picker's read
// and the one carrying `list_installed_skills` (owned/resolved split,
// 2026-08-03).
const EXPECTED_SKILLS_METHODS = [
  'install',
  'listAvailable',
  'listInstalled',
  'listInstalledResolved',
  'synchronize',
  'uninstall',
  'updateSettings',
] as const

// The marketplace namespace's methods, sorted. Two read GETs
// (listItems / getItem) + install (M4b-2 — cloud artifact or bundled skill)
// + update (claude-official arc, 2026-08-01 — skills-only, to the catalog's
// latest) + uninstall (removal flows, 2026-07-13 — kind-dispatched like
// install). All five carry x-mcp (task 4b, 2026-07-26 — reverses D9).
const EXPECTED_MARKETPLACE_METHODS = [
  'getItem',
  'install',
  'listItems',
  'uninstall',
  'update',
] as const

// The marketplaceUser namespace's methods, sorted — the USER-scoped
// `/marketplace` surface (the GLOBAL marketplace, 2026-07-13 — deliberate
// spec addition): lists user+both items and installs/updates/uninstalls at
// USER scope. Distinct top namespace from the workspace-scoped
// `marketplace.*` (the schedulesUser naming precedent). No getItem — the
// global section renders from the list read alone. None carry x-mcp (the
// global surface stayed unexposed when task 4b exposed the workspace one).
const EXPECTED_MARKETPLACE_USER_METHODS = ['install', 'listItems', 'uninstall', 'update'] as const

// The schedules namespace's methods, sorted. The 3 read GETs (list /
// listTemplates / listRuns) + the 6 mutating lifecycle routes all carry
// `x-sdk-name`; x-mcp is the narrower opt-in (only the 3 GETs are exposed).
// `fireNow` drives a headless turn (never an MCP tool — no x-mcp).
const EXPECTED_SCHEDULES_METHODS = [
  'create',
  'delete',
  'disable',
  'enable',
  'fireNow',
  'list',
  'listRuns',
  'listTemplates',
  'update',
] as const

// The schedulesUser namespace's methods, sorted — the USER-scoped `/schedules`
// surface (a user's global + workspace schedules alike). Distinct top namespace
// from the workspace-scoped `schedules.*`. `/templates` is omitted (already
// global via the workspace route). Only `list` (list_my_schedules) is x-mcp;
// `fireNow` drives a headless turn (never an MCP tool).
const EXPECTED_SCHEDULES_USER_METHODS = [
  'create',
  'delete',
  'disable',
  'enable',
  'fireNow',
  'list',
  'listRuns',
  'update',
] as const

// The workspaceApps namespace, sorted (apps module, 2026-07-17) — register +
// run + monitor a workspace's apps. `remove` is user-only (no x-mcp).
// test: correct expectation — the env editor (2026-08-11) added `env` +
// `updateEnv` (both user-only, no x-mcp: env values are secrets).
const EXPECTED_WORKSPACE_APPS_METHODS = [
  'add',
  'env',
  'list',
  'logs',
  'remove',
  'start',
  'stop',
  'update',
  'updateEnv',
] as const

// The asks namespace, sorted (ask module, 2026-07-17) — the ask_user
// answering surface (USER-scoped only; the agent's surface is the
// `vynel-ask` descriptor tool, so no route is x-mcp).
const EXPECTED_ASKS_METHODS = ['answer', 'dismiss', 'listPending'] as const

// The sshServers namespace, sorted (ssh module, 2026-07-17) — the USER-scoped
// registration surface. The credential goes IN through `add` and never comes
// back out anywhere; the agent's surface is the `vynel-ssh` descriptor, so no
// route is x-mcp.
const EXPECTED_SSH_SERVERS_METHODS = ['add', 'list', 'remove', 'testConnection'] as const

// The tasks namespaces, sorted (tasks module, 2026-07-17). Workspace-scoped
// `tasks.*` is the AGENT's surface (create stamps source='assistant'; no
// delete — removal is the user's call); user-scoped `tasksUser.*` is the
// panel/dashboard/CLI surface (create stamps source='user', spans both
// scopes, owns delete). The task-execution arc (2026-08-18) added the STEP
// surface: the agent's whole-list `setSteps`, the user's read/tick/delete.
const EXPECTED_TASKS_METHODS = ['complete', 'create', 'list', 'setSteps', 'update'] as const
const EXPECTED_TASKS_USER_METHODS = [
  'create',
  'delete',
  'deleteStep',
  'list',
  'listSteps',
  'update',
  'updateStepStatus',
] as const

// The notebook namespace's methods, sorted — the USER-scoped `/notebook`
// surface (deliberate spec addition, 2026-07-12): the merged playbook shelf
// (verified books + the user's own) and the own-document CRUD. No route is
// x-mcp — Claude reads the notebook via the `vynel-notebook` feature
// descriptor and never writes it.
const EXPECTED_NOTEBOOK_METHODS = [
  'createDocument',
  'deleteDocument',
  'getPlaybook',
  'listDocuments',
  'listPlaybooks',
  'updateDocument',
] as const

// Build a client stub whose every verb resolves to one canned
// openapi-fetch result — drives the generated dispatch's success + error branches.
function clientReturning(result: {
  data?: unknown
  error?: unknown
  response: Response
}): Client<paths> {
  const verb = async (): Promise<unknown> => result
  return { GET: verb, POST: verb, PUT: verb, PATCH: verb, DELETE: verb } as unknown as Client<paths>
}

// A client stub that records the (path, init) each verb is called with —
// enough to assert what the generated dispatch passes to openapi-fetch.
type CapturedCall = { path: string; init: { params?: { path?: unknown; query?: unknown } } }
function capturingClient(): { client: Client<paths>; calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  const verb = async (path: string, init: unknown): Promise<unknown> => {
    calls.push({ path, init: (init ?? {}) as CapturedCall['init'] })
    return { data: {}, error: undefined, response: new Response(null, { status: 200 }) }
  }
  return {
    client: {
      GET: verb,
      POST: verb,
      PUT: verb,
      PATCH: verb,
      DELETE: verb,
    } as unknown as Client<paths>,
    calls,
  }
}

describe('makeNamespaced — shape', () => {
  it('exposes every landed namespace with the original groups\' annotated methods', () => {
    const sdk = makeNamespaced(stubClient)
    // The full namespace list as of the 2026-07-05 API-completion waves. A
    // namespace appearing/disappearing here means a route group (or its
    // x-sdk-name prefix) changed — deliberate changes update this list.
    // test: correct expectation — the realtime slice added `activity`
    // (GET /activity/stream, the session-activity SSE feed).
    expect(Object.keys(sdk).sort()).toEqual([
      'activity',
      'agents',
      'approvalRules',
      'approvals',
      'approvalsWorkspace',
      'asks',
      'capabilities',
      'channels',
      'channelsUser',
      'chat',
      // test: correct expectation — the config-surfaces slice (2026-08-02)
      // added the Claude-config route twins (rules / commands / mcp-servers,
      // workspace + user each) and the user-scoped skills anchor the GLOBAL
      // menus read.
      'commands',
      'commandsUser',
      // test: correct expectation — customization moved to the DB (2026-08-19):
      // ONE user-scoped door for every scope's look + the tree layout.
      'customizations',
      'dashboard',
      // test: correct expectation — the usage-statistics slice (2026-07-31)
      // added `dashboardWorkspace` (GET /workspaces/:id/dashboard/usage, the
      // per-workspace dashboard twin).
      'dashboardWorkspace',

      // test: correct expectation — the Display arc (2026-08-21) added `display`

      // (/display/widgets — the widgets board Claude writes to).

      'display',
      // test: correct expectation — `desktopAccess` REMOVED (2026-08-13). The
      // per-app grant model it fronted (GET/DELETE /desktop/access) is retired:
      // the turn's approved plan is the only authority for acting, and looking
      // is ungated, so there is no grant list to read or revoke.
      // test: correct expectation — the engineering-plan modules (2026-08-11)
      // added `phases` + `features` (agent-only workspace surfaces).
      'features',
      'files',
      // test: correct expectation — the GitHub connection (2026-08-23) added
      // `github` (/github/connection — the app's one sign-in over the gh CLI).
      'github',
      'hub',
      // test: correct expectation — the plans + journal modules (2026-07-23)
      // added their two-door namespaces (agent + user surfaces each).
      'journal',
      'journalUser',
      'knowledge',
      // test: correct expectation — the global-scoping slice (2026-08-02)
      // gave knowledge + memory their user-scoped twins, the anchors the
      // GLOBAL menus read (only null-workspace rows; the workspace routes
      // keep their fusion).
      'knowledgeUser',
      // test: correct expectation — Settings → Embedding / Voice (2026-08-22)
      // added the local-models surface (status / download / cancel / remove).
      'localModels',
      'marketplace',
      // test: correct expectation — the marketplace-sources move
      // (2026-08-09) added the sources management surface (user-registered
      // claude marketplaces: list/add/remove), a namespace of its own.
      'marketplaceSources',
      'marketplaceUser',
      'mcpServers',
      'mcpServersUser',
      'memory',
      'memoryUser',
      // the monitors module (2026-07-26) — a two-door namespace like plans:
      // the workspace surface and its global twin.
      'monitors',
      'monitorsUser',
      'notebook',
      'onboarding',
      'phases',
      'plans',
      'plansUser',
      // background processes (2026-08-17) — ONE door on every surface (the
      // send_message rule), so a single namespace with no user twin.
      'processes',
      'providers',
      'root',
      'routing',
      'rules',
      'rulesUser',
      'schedules',
      'schedulesUser',
      // test: correct expectation — the canvas menu pass (3f0896b) added the
      // per-section count routes, so the generator emits `sectionCounts`
      // (GET /section-counts) and its workspace-scoped twin. Real routes:
      // `sectionCountsApp` / `sectionCountsWorkspaceApp` in local-api's
      // app.ts. The list was simply never updated with them.
      'sectionCounts',
      'sectionCountsWorkspace',
      // test: correct expectation — Phase D2 added `serverInstall` (the
      // remote-engine provisioning routes).
      'serverInstall',
      // test: correct expectation — session-library Slice ③ added `sessions`
      // (GET /sessions/overview, the unified session list).
      'sessions',
      'skills',
      'skillsUser',
      'sshServers',
      'tasks',
      'tasksUser',
      // test: correct expectation — the working-steps dock added `todos`
      // (/todos: the agent's whole-list replace + the user's dock ops).
      'todos',
      // test: correct expectation — the tool-policy admin matrix added
      // `toolPolicies` (/tool-policies: list/save/reset; x-mcp-free).
      'toolPolicies',
      'users',
      'voice',
      'voiceProviders',
      'workspaceApps',
      'workspaces',
    ])
    expect(Object.keys(sdk.knowledge).sort()).toEqual([...EXPECTED_KNOWLEDGE_METHODS])
    expect(Object.keys(sdk.approvals).sort()).toEqual([...EXPECTED_APPROVALS_METHODS])
    expect(Object.keys(sdk.skills).sort()).toEqual([...EXPECTED_SKILLS_METHODS])
    expect(Object.keys(sdk.channels).sort()).toEqual([...EXPECTED_CHANNELS_METHODS])
    expect(Object.keys(sdk.channelsUser).sort()).toEqual([...EXPECTED_CHANNELS_USER_METHODS])
    expect(Object.keys(sdk.marketplace).sort()).toEqual([...EXPECTED_MARKETPLACE_METHODS])
    expect(Object.keys(sdk.marketplaceUser).sort()).toEqual([...EXPECTED_MARKETPLACE_USER_METHODS])
    expect(Object.keys(sdk.schedules).sort()).toEqual([...EXPECTED_SCHEDULES_METHODS])
    expect(Object.keys(sdk.schedulesUser).sort()).toEqual([...EXPECTED_SCHEDULES_USER_METHODS])
    expect(Object.keys(sdk.tasks).sort()).toEqual([...EXPECTED_TASKS_METHODS])
    expect(Object.keys(sdk.tasksUser).sort()).toEqual([...EXPECTED_TASKS_USER_METHODS])
    expect(Object.keys(sdk.asks).sort()).toEqual([...EXPECTED_ASKS_METHODS])
    expect(Object.keys(sdk.sshServers).sort()).toEqual([...EXPECTED_SSH_SERVERS_METHODS])
    expect(Object.keys(sdk.workspaceApps).sort()).toEqual([...EXPECTED_WORKSPACE_APPS_METHODS])
    expect(Object.keys(sdk.notebook).sort()).toEqual([...EXPECTED_NOTEBOOK_METHODS])
  })

  it('every method in every namespace is a function', () => {
    const sdk = makeNamespaced(stubClient)
    for (const namespace of Object.values(sdk)) {
      for (const method of Object.values(namespace)) {
        expect(typeof method).toBe('function')
      }
    }
  })
})

describe('makeNamespaced — runtime', () => {
  it('returns the response body on a 2xx', async () => {
    const body = { totalDocuments: 3 }
    const sdk = makeNamespaced(
      clientReturning({ data: body, response: new Response(null, { status: 200 }) }),
    )
    await expect(sdk.knowledge.getStatus('ws_1')).resolves.toEqual(body)
  })

  it('throws SdkError with the status + envelope message on a non-2xx', async () => {
    const sdk = makeNamespaced(
      clientReturning({
        error: { code: 'not_found', message: 'Workspace not found.' },
        response: new Response(null, { status: 404 }),
      }),
    )
    await expect(sdk.knowledge.getStatus('ws_missing')).rejects.toMatchObject({
      name: 'SdkError',
      status: 404,
      message: 'Workspace not found.',
    })
    await expect(sdk.knowledge.getStatus('ws_missing')).rejects.toBeInstanceOf(SdkError)
  })
})

describe('makeNamespaced — request shaping', () => {
  it('omits the query key entirely when an optional query arg is absent', async () => {
    const { client, calls } = capturingClient()
    await makeNamespaced(client).knowledge.listDocuments('ws_1')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init.params).toEqual({ path: { workspaceId: 'ws_1' } })
  })

  it('includes the query key when the optional query arg is passed', async () => {
    const { client, calls } = capturingClient()
    await makeNamespaced(client).knowledge.listDocuments('ws_1', { limit: 5 })
    expect(calls[0]?.init.params).toEqual({ path: { workspaceId: 'ws_1' }, query: { limit: 5 } })
  })

  it('passes a required query straight through', async () => {
    const { client, calls } = capturingClient()
    await makeNamespaced(client).knowledge.search('ws_1', { query: 'onboarding' })
    expect(calls[0]?.init.params).toEqual({
      path: { workspaceId: 'ws_1' },
      query: { query: 'onboarding' },
    })
  })
})

// Type-level regression guard for B (routes declaring response schemas →
// typed SDK returns). Checked by `turbo typecheck` (tsc compiles this
// file). If a route loses its response `content` schema, its resolved
// return reverts to `undefined` and `toHaveProperty` fails to compile.
describe('makeNamespaced — return types', () => {
  type KnowledgeSdk = ReturnType<typeof makeNamespaced>['knowledge']
  type ApprovalsSdk = ReturnType<typeof makeNamespaced>['approvals']

  it('types search() as the results envelope, not undefined', () => {
    expectTypeOf<Awaited<ReturnType<KnowledgeSdk['search']>>>().toHaveProperty('results')
  })

  it('types getStatus() as the indexer-status envelope', () => {
    expectTypeOf<Awaited<ReturnType<KnowledgeSdk['getStatus']>>>().toHaveProperty('totalDocuments')
  })

  it('types listDocuments() as the documents envelope', () => {
    expectTypeOf<Awaited<ReturnType<KnowledgeSdk['listDocuments']>>>().toHaveProperty('documents')
    expectTypeOf<Awaited<ReturnType<KnowledgeSdk['listDocuments']>>>().toHaveProperty('nextCursor')
  })

  it('types getDocument() as document + chunks', () => {
    expectTypeOf<Awaited<ReturnType<KnowledgeSdk['getDocument']>>>().toHaveProperty('chunks')
  })

  it('types reindex() as the count envelope', () => {
    expectTypeOf<Awaited<ReturnType<KnowledgeSdk['reindex']>>>().toHaveProperty('indexedCount')
  })

  it('types listPending() as an array of approval requests, not undefined', () => {
    expectTypeOf<Awaited<ReturnType<ApprovalsSdk['listPending']>>[number]>().toHaveProperty(
      'providerApprovalId',
    )
  })

  it('types decide() as the resolved approval request, not undefined', () => {
    expectTypeOf<Awaited<ReturnType<ApprovalsSdk['decide']>>>().toHaveProperty('providerApprovalId')
  })
})
