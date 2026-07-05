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
  'addDirectory',
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
  'connect',
  'disable',
  'disconnect',
  'enable',
  'get',
  'history',
  'list',
  'listAllowedSenders',
  'removeAllowedSender',
] as const

// The skills namespace's methods, sorted. The 2 read GETs + the 6
// mutating lifecycle/settings routes all carry `x-sdk-name` (x-mcp is a
// separate, narrower opt-in — only the 2 GETs are MCP-exposed).
const EXPECTED_SKILLS_METHODS = [
  'disable',
  'enable',
  'install',
  'listAvailable',
  'listInstalled',
  'synchronize',
  'uninstall',
  'updateSettings',
] as const

// The marketplace namespace's methods, sorted. Two read GETs
// (listItems / getItem) carry `x-sdk-name`; NEITHER carries x-mcp (D9 —
// marketplace's reads are the join of skills' already-exposed
// list_available + list_installed tools, redundant for the LLM).
const EXPECTED_MARKETPLACE_METHODS = ['getItem', 'listItems'] as const

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
    expect(Object.keys(sdk).sort()).toEqual([
      'agents',
      'approvalRules',
      'approvals',
      'approvalsWorkspace',
      'capabilities',
      'channels',
      'channelsUser',
      'chat',
      'dashboard',
      'files',
      'knowledge',
      'marketplace',
      'memory',
      'onboarding',
      'providers',
      'root',
      'routing',
      'schedules',
      'schedulesUser',
      'skills',
      'users',
      'workspaces',
    ])
    expect(Object.keys(sdk.knowledge).sort()).toEqual([...EXPECTED_KNOWLEDGE_METHODS])
    expect(Object.keys(sdk.approvals).sort()).toEqual([...EXPECTED_APPROVALS_METHODS])
    expect(Object.keys(sdk.skills).sort()).toEqual([...EXPECTED_SKILLS_METHODS])
    expect(Object.keys(sdk.channels).sort()).toEqual([...EXPECTED_CHANNELS_METHODS])
    expect(Object.keys(sdk.channelsUser).sort()).toEqual([...EXPECTED_CHANNELS_USER_METHODS])
    expect(Object.keys(sdk.marketplace).sort()).toEqual([...EXPECTED_MARKETPLACE_METHODS])
    expect(Object.keys(sdk.schedules).sort()).toEqual([...EXPECTED_SCHEDULES_METHODS])
    expect(Object.keys(sdk.schedulesUser).sort()).toEqual([...EXPECTED_SCHEDULES_USER_METHODS])
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
