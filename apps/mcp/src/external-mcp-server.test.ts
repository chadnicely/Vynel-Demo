// Tests for the external MCP adapter's tool collection + dispatch. Drives
// `collectExternalTools` against a fixture spec + a capturing dispatch — the
// same seam the bin uses — so curation, URL/body building, and error mapping
// are covered without stdio or a running api.

import { describe, expect, it } from 'vitest'
import { collectExternalTools, type FetchDispatch, type OpenApiSpec } from './external-mcp-server.js'

const spec: OpenApiSpec = {
  paths: {
    '/workspaces/{workspaceId}/knowledge/search': {
      get: {
        parameters: [
          { name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
          // Exercise the Zod builder's enum / nullable / array branches.
          { name: 'sort', in: 'query', required: false, schema: { enum: ['asc', 'desc'] } },
          { name: 'cursor', in: 'query', required: false, schema: { type: ['string', 'null'] } },
          { name: 'kinds', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } } },
        ],
        'x-mcp': { exposed: true, name: 'search_knowledge', description: 'Search.' },
      },
    },
    '/workspaces/{workspaceId}/knowledge/reindex': {
      // Not exposed → excluded (mirrors the real reindex route).
      post: {
        parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }],
        'x-mcp': { exposed: false, name: 'reindex', description: 'no' },
      },
    },
    '/unapproved': {
      // Mutating + exposed but NOT mutatingApproved → excluded (D7 gate).
      post: {
        'x-mcp': { exposed: true, name: 'unapproved_mutation', description: 'no' },
      },
    },
    '/things': {
      // Mutating + approved → included, sends a JSON body.
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { properties: { title: { type: 'string' } }, required: ['title'] },
            },
          },
        },
        'x-mcp': { exposed: true, name: 'create_thing', description: 'Create.', mutatingApproved: true },
      },
    },
  },
}

function capturingDispatch(response: Response): {
  dispatch: FetchDispatch
  calls: Array<{ url: string; init?: RequestInit }>
} {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const dispatch: FetchDispatch = async (url, init) => {
    // Narrow so `undefined` is never stored (exactOptionalPropertyTypes).
    calls.push(init === undefined ? { url } : { url, init })
    return response
  }
  return { dispatch, calls }
}

const noopDispatch: FetchDispatch = async () => new Response('', { status: 200 })

describe('collectExternalTools — curation', () => {
  it('exposes only exposed reads + approved mutations, sorted, mirroring the agent registry', () => {
    const names = collectExternalTools(spec, noopDispatch).map((t) => t.name)
    // reindex (not exposed) + unapproved_mutation (mutating, unapproved) excluded.
    expect(names).toStrictEqual(['create_thing', 'search_knowledge'])
  })

  it('flags mutating tools with destructiveHint, reads with readOnlyHint', () => {
    const tools = collectExternalTools(spec, noopDispatch)
    const search = tools.find((t) => t.name === 'search_knowledge')
    const create = tools.find((t) => t.name === 'create_thing')
    expect(search?.annotations).toStrictEqual({ readOnlyHint: true })
    expect(create?.annotations).toStrictEqual({ readOnlyHint: false, destructiveHint: true })
  })
})

describe('collectExternalTools — input schema', () => {
  it('builds required vs optional + coerces enum / nullable / array / number branches', () => {
    const shape = collectExternalTools(spec, noopDispatch).find((t) => t.name === 'search_knowledge')!
      .inputSchema
    // required vs optional
    expect(shape.workspaceId!.isOptional()).toBe(false) // path param → required
    expect(shape.query!.isOptional()).toBe(false) // required query
    expect(shape.limit!.isOptional()).toBe(true) // optional query
    // number (not string)
    expect(shape.limit!.safeParse(5).success).toBe(true)
    expect(shape.limit!.safeParse('x').success).toBe(false)
    // enum
    expect(shape.sort!.safeParse('asc').success).toBe(true)
    expect(shape.sort!.safeParse('nope').success).toBe(false)
    // nullable (type: ['string', 'null'])
    expect(shape.cursor!.safeParse(null).success).toBe(true)
    expect(shape.cursor!.safeParse('c1').success).toBe(true)
    // array of string
    expect(shape.kinds!.safeParse(['a', 'b']).success).toBe(true)
    expect(shape.kinds!.safeParse('a').success).toBe(false)
  })
})

describe('collectExternalTools — dispatch', () => {
  it('a GET builds path + query and returns the body on 2xx', async () => {
    const { dispatch, calls } = capturingDispatch(new Response('the-results', { status: 200 }))
    const search = collectExternalTools(spec, dispatch).find((t) => t.name === 'search_knowledge')!
    const result = await search.handler({ workspaceId: 'ws_1', query: 'onboarding', limit: 5 })
    expect(calls[0]?.url).toBe('/workspaces/ws_1/knowledge/search?query=onboarding&limit=5')
    expect(calls[0]?.init?.method).toBe('GET')
    expect(result).toStrictEqual({ content: [{ type: 'text', text: 'the-results' }] })
  })

  it('a POST sends a JSON body', async () => {
    const { dispatch, calls } = capturingDispatch(new Response('{"id":"x"}', { status: 200 }))
    const create = collectExternalTools(spec, dispatch).find((t) => t.name === 'create_thing')!
    await create.handler({ title: 'hello' })
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ title: 'hello' }))
    expect((calls[0]?.init?.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('maps a non-2xx to an isError text result', async () => {
    const { dispatch } = capturingDispatch(new Response('nope', { status: 404 }))
    const search = collectExternalTools(spec, dispatch).find((t) => t.name === 'search_knowledge')!
    const result = await search.handler({ workspaceId: 'ws_missing', query: 'x' })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Error 404')
  })

  // An outside MCP client has no approvals reaper behind it — a wedged api would
  // park it forever. Every dispatch carries a cancelling deadline, reads and
  // mutations alike.
  it('carries an abort signal on every dispatch', async () => {
    const { dispatch, calls } = capturingDispatch(new Response('ok', { status: 200 }))
    const tools = collectExternalTools(spec, dispatch)
    await tools.find((t) => t.name === 'search_knowledge')!.handler({ workspaceId: 'w', query: 'q' })
    await tools.find((t) => t.name === 'create_thing')!.handler({ title: 'hello' })

    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[1]?.init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('names the timeout instead of leaking "operation was aborted"', async () => {
    const timingOutDispatch: FetchDispatch = async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    }
    const search = collectExternalTools(spec, timingOutDispatch).find(
      (t) => t.name === 'search_knowledge',
    )!
    const result = await search.handler({ workspaceId: 'w', query: 'q' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('timed out')
    expect(result.content[0]?.text).toContain('did not respond')
  })
})
