// Pins the manifest parser's compatibility contract: published manifests are
// immutable hub rows, so the OLD stdio shape must parse unchanged and an old
// remote manifest (URL in `commandOrUrl`) must lift into the discriminated
// `url` shape instead of dropping off the shelf. The auth declarations
// (2026-08-09) are additive: declaration-less rows parse exactly as before
// (plus the empty `requiredEnvironment` default), and the resolver turns
// manifest + user-supplied values into the config writer's entry shape.

import { describe, expect, it } from 'vitest'
import {
  parseMcpItemManifest,
  resolveMcpInstallConfiguration,
  toMcpItemAuthView,
} from './mcp-item-manifest.js'

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
      requiredEnvironment: [],
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
      requiredEnvironment: [],
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

  it('parses declared auth: requiredEnvironment (secret defaults true), header fields, oauth', () => {
    const stdio = parseMcpItemManifest(
      JSON.stringify({
        serverName: 'github',
        transport: 'stdio',
        commandOrUrl: 'npx',
        requiredEnvironment: [{ name: 'GITHUB_TOKEN', label: 'GitHub token' }],
      }),
    )
    expect(stdio).toMatchObject({
      requiredEnvironment: [{ name: 'GITHUB_TOKEN', label: 'GitHub token', secret: true }],
    })

    const headerAuth = parseMcpItemManifest(
      JSON.stringify({
        serverName: 'corridor',
        transport: 'http',
        url: 'https://app.corridor.dev/api/mcp',
        auth: {
          type: 'headers',
          requiredHeaders: [{ name: 'Authorization', label: 'API key', secret: true }],
        },
      }),
    )
    expect(headerAuth).toMatchObject({
      auth: {
        type: 'headers',
        requiredHeaders: [{ name: 'Authorization', label: 'API key', secret: true }],
      },
    })

    const oauth = parseMcpItemManifest(
      JSON.stringify({
        serverName: 'notion',
        transport: 'http',
        url: 'https://mcp.notion.com/mcp',
        auth: { type: 'oauth' },
      }),
    )
    expect(oauth).toMatchObject({ auth: { type: 'oauth' } })
  })
})

describe('toMcpItemAuthView', () => {
  const parse = (value: unknown) => parseMcpItemManifest(JSON.stringify(value))!

  it('answers null when nothing is needed', () => {
    expect(
      toMcpItemAuthView(parse({ serverName: 's', transport: 'stdio', commandOrUrl: 'node' })),
    ).toBeNull()
    expect(
      toMcpItemAuthView(parse({ serverName: 'r', transport: 'http', url: 'https://x.dev/mcp' })),
    ).toBeNull()
  })

  it('answers fields for declared env/header requirements and oauth for oauth', () => {
    expect(
      toMcpItemAuthView(
        parse({
          serverName: 'github',
          transport: 'stdio',
          commandOrUrl: 'npx',
          requiredEnvironment: [{ name: 'GITHUB_TOKEN', label: 'GitHub token' }],
        }),
      ),
    ).toEqual({
      kind: 'fields',
      fields: [{ name: 'GITHUB_TOKEN', label: 'GitHub token', secret: true }],
    })
    expect(
      toMcpItemAuthView(
        parse({
          serverName: 'notion',
          transport: 'http',
          url: 'https://mcp.notion.com/mcp',
          auth: { type: 'oauth' },
        }),
      ),
    ).toEqual({ kind: 'oauth' })
  })
})

describe('resolveMcpInstallConfiguration', () => {
  const parse = (value: unknown) => parseMcpItemManifest(JSON.stringify(value))!

  it('merges supplied env values over publisher defaults and strips declarations', () => {
    const manifest = parse({
      serverName: 'github',
      transport: 'stdio',
      commandOrUrl: 'npx',
      args: ['github-mcp'],
      environment: { LOG_LEVEL: 'warn' },
      requiredEnvironment: [{ name: 'GITHUB_TOKEN', label: 'GitHub token' }],
    })
    const resolved = resolveMcpInstallConfiguration(manifest, { GITHUB_TOKEN: 'tok-1' })
    expect(resolved).toEqual({
      ok: true,
      authRequired: false,
      server: {
        serverName: 'github',
        transport: 'stdio',
        commandOrUrl: 'npx',
        args: ['github-mcp'],
        environment: { LOG_LEVEL: 'warn', GITHUB_TOKEN: 'tok-1' },
      },
    })
  })

  it('merges supplied header values for a headers-auth remote', () => {
    const manifest = parse({
      serverName: 'corridor',
      transport: 'http',
      url: 'https://app.corridor.dev/api/mcp',
      headers: { 'X-Client': 'vynel' },
      auth: { type: 'headers', requiredHeaders: [{ name: 'Authorization', label: 'API key' }] },
    })
    const resolved = resolveMcpInstallConfiguration(manifest, { Authorization: 'Bearer k' })
    expect(resolved).toEqual({
      ok: true,
      authRequired: false,
      server: {
        serverName: 'corridor',
        transport: 'http',
        url: 'https://app.corridor.dev/api/mcp',
        headers: { 'X-Client': 'vynel', Authorization: 'Bearer k' },
      },
    })
  })

  it('an oauth manifest resolves credential-less with authRequired true', () => {
    const manifest = parse({
      serverName: 'notion',
      transport: 'http',
      url: 'https://mcp.notion.com/mcp',
      auth: { type: 'oauth' },
    })
    const resolved = resolveMcpInstallConfiguration(manifest, {})
    expect(resolved).toEqual({
      ok: true,
      authRequired: true,
      server: {
        serverName: 'notion',
        transport: 'http',
        url: 'https://mcp.notion.com/mcp',
        headers: {},
      },
    })
  })

  it('reports missing (absent or blank) fields by LABEL and unknown names by name', () => {
    const manifest = parse({
      serverName: 'github',
      transport: 'stdio',
      commandOrUrl: 'npx',
      requiredEnvironment: [
        { name: 'GITHUB_TOKEN', label: 'GitHub token' },
        { name: 'GITHUB_ORG', label: 'Organization' },
      ],
    })
    const resolved = resolveMcpInstallConfiguration(manifest, {
      GITHUB_TOKEN: '   ',
      SNEAKY_VAR: 'x',
    })
    expect(resolved).toEqual({
      ok: false,
      missingFieldLabels: ['GitHub token', 'Organization'],
      unknownFieldNames: ['SNEAKY_VAR'],
    })
  })

  it('refuses undeclared values even when all required fields are supplied', () => {
    const manifest = parse({ serverName: 's', transport: 'stdio', commandOrUrl: 'node' })
    const resolved = resolveMcpInstallConfiguration(manifest, { PATH: '/evil' })
    expect(resolved).toEqual({
      ok: false,
      missingFieldLabels: [],
      unknownFieldNames: ['PATH'],
    })
  })
})
