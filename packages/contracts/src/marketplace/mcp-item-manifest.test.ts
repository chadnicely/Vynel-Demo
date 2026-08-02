// Pins the manifest parser's compatibility contract: published manifests are
// immutable hub rows, so the OLD stdio shape must parse unchanged and an old
// remote manifest (URL in `commandOrUrl`) must lift into the discriminated
// `url` shape instead of dropping off the shelf.

import { describe, expect, it } from 'vitest'
import { parseMcpItemManifest } from './mcp-item-manifest.js'

describe('parseMcpItemManifest', () => {
  it('parses the published stdio shape unchanged (playwright seed)', () => {
    const parsed = parseMcpItemManifest(
      JSON.stringify({
        serverName: 'playwright',
        transport: 'stdio',
        commandOrUrl: 'npx',
        args: ['@playwright/mcp@latest'],
        environment: {},
      }),
    )
    expect(parsed).toEqual({
      serverName: 'playwright',
      transport: 'stdio',
      commandOrUrl: 'npx',
      args: ['@playwright/mcp@latest'],
      environment: {},
    })
  })

  it('defaults args/environment on a minimal stdio manifest', () => {
    const parsed = parseMcpItemManifest(
      JSON.stringify({ serverName: 's', transport: 'stdio', commandOrUrl: 'node' }),
    )
    expect(parsed).toEqual({
      serverName: 's',
      transport: 'stdio',
      commandOrUrl: 'node',
      args: [],
      environment: {},
    })
  })

  it('parses the discriminated remote shape (url + headers)', () => {
    const parsed = parseMcpItemManifest(
      JSON.stringify({
        serverName: 'linear',
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      }),
    )
    expect(parsed).toEqual({
      serverName: 'linear',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    })
  })

  it('lifts a legacy remote manifest (URL in commandOrUrl) into the url shape', () => {
    const parsed = parseMcpItemManifest(
      JSON.stringify({
        serverName: 'legacy-remote',
        transport: 'sse',
        commandOrUrl: 'https://old.example.com/sse',
        args: [],
        environment: {},
      }),
    )
    expect(parsed).toEqual({
      serverName: 'legacy-remote',
      transport: 'sse',
      url: 'https://old.example.com/sse',
      headers: {},
    })
  })

  it('answers null on junk instead of throwing', () => {
    expect(parseMcpItemManifest(null)).toBeNull()
    expect(parseMcpItemManifest('{not json')).toBeNull()
    expect(parseMcpItemManifest(JSON.stringify({ serverName: 'x', transport: 'http' }))).toBeNull()
  })
})
