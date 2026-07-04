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

// The schedules namespace's methods, sorted. The 3 read GETs (list /
// listTemplates / listRuns) + the 5 mutating lifecycle routes all carry
// `x-sdk-name`; x-mcp is the narrower opt-in (only the 3 GETs are exposed).
// The source `fire-now` route is deferred (its MCP-turn composition lands with
// the session Slice-3 app-wiring), so there is no `fireNow` method here.
const EXPECTED_SCHEDULES_METHODS = [
  'create',
  'delete',
  'disable',
  'enable',
  'list',
  'listRuns',
  'listTemplates',
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
  it('exposes the knowledge + approvals + skills + channels + schedules namespaces with their annotated methods', () => {
    const sdk = makeNamespaced(stubClient)
    expect(Object.keys(sdk).sort()).toEqual([
      'approvals',
      'channels',
      'knowledge',
      'schedules',
      'skills',
    ])
    expect(Object.keys(sdk.knowledge).sort()).toEqual([...EXPECTED_KNOWLEDGE_METHODS])
    expect(Object.keys(sdk.approvals).sort()).toEqual([...EXPECTED_APPROVALS_METHODS])
    expect(Object.keys(sdk.skills).sort()).toEqual([...EXPECTED_SKILLS_METHODS])
    expect(Object.keys(sdk.channels).sort()).toEqual([...EXPECTED_CHANNELS_METHODS])
    expect(Object.keys(sdk.schedules).sort()).toEqual([...EXPECTED_SCHEDULES_METHODS])
  })

  it('every method is a function', () => {
    const sdk = makeNamespaced(stubClient)
    for (const method of [
      ...Object.values(sdk.knowledge),
      ...Object.values(sdk.approvals),
      ...Object.values(sdk.skills),
      ...Object.values(sdk.channels),
      ...Object.values(sdk.schedules),
    ]) {
      expect(typeof method).toBe('function')
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
})
