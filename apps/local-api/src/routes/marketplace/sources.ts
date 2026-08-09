// The user's registered Claude-native marketplaces — the marketplace's
// SOURCES management surface, mounted at `/marketplace/sources` (global
// surface; adding a marketplace is a per-user trust decision, so there is
// no workspace twin). Delegate-to-native throughout: the CLI owns the
// clone, the registry file, and the settings declaration; these routes
// only drive it and read its files.
//
//   GET    /       -> registered marketplaces + their plugin counts
//   POST   /       -> register (normalized to the https .git URL form)
//   DELETE /:name  -> deregister (installed plugins from it keep working —
//                     Claude Code keeps its cache; their rows leave the shelf)
//
// **No `x-mcp` on any route** — a session must never register a source of
// executable plugins on the user's behalf (hooks and MCP servers ride
// plugins); trust decisions stay human.

import { resolver, validator } from 'hono-openapi/zod'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'

const MarketplaceSourceRowSchema = z.object({
  marketplaceName: z.string(),
  sourceUrl: z.string().nullable(),
  ownerName: z.string().nullable(),
  pluginCount: z.number(),
})

const ListMarketplaceSourcesResponseSchema = z.object({
  sources: z.array(MarketplaceSourceRowSchema),
})

const AddMarketplaceSourceBodySchema = z.object({
  /** A github `owner/repo` shorthand or an https git URL. */
  source: z.string().min(3).max(300),
})

const SourceNameParamSchema = z.object({
  marketplaceName: z.string().min(1).max(120),
})

// The CLI's `owner/repo` shorthand needs auth state the daemon may not
// have (probed 2026-08-09) — normalize everything to the https .git URL
// form, which clones bare-git reliably. https-only mirrors the MCP
// remote-URL policy: a marketplace carries executable plugins.
const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/

function normalizeMarketplaceSource(raw: string): string {
  const trimmed = raw.trim()
  if (GITHUB_SHORTHAND.test(trimmed)) return `https://github.com/${trimmed}.git`
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ValidationError(
      'The marketplace source should be a GitHub `owner/repo` or an https git URL.',
    )
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError(
      'Marketplace sources must use https — a marketplace carries executable plugins.',
    )
  }
  // A credentials-bearing URL would persist the token into Claude's
  // registry file and this route's log line — refuse rather than redact.
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ValidationError(
      'Marketplace URLs must not embed credentials — use a public https URL.',
    )
  }
  return trimmed
}

export const marketplaceSourcesApp = factory
  .createApp()
  .get(
    '/',
    describeRoute({
      tags: ['marketplace'],
      summary: "List the user's registered Claude plugin marketplaces.",
      'x-sdk-name': 'marketplaceSources.list',
      responses: {
        200: {
          description: 'Registered marketplaces with their catalog sizes.',
          content: {
            'application/json': { schema: resolver(ListMarketplaceSourcesResponseSchema) },
          },
        },
      },
    }),
    ...userScoped,
    (c) => {
      const sources = c.var.claudeMarketplacesReader().map((source) => ({
        marketplaceName: source.marketplaceName,
        sourceUrl: source.sourceUrl,
        ownerName: source.ownerName,
        pluginCount: source.plugins.length,
      }))
      return c.json({ sources })
    },
  )
  .post(
    '/',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Register a Claude plugin marketplace (its plugins join the shelf).',
      'x-sdk-name': 'marketplaceSources.add',
      responses: {
        201: {
          description: 'Registered; the marketplace now lists.',
          content: {
            'application/json': { schema: resolver(MarketplaceSourceRowSchema) },
          },
        },
        400: { description: 'Not an https git source, or the CLI refused the registration.' },
      },
    }),
    validator('json', AddMarketplaceSourceBodySchema),
    ...userScoped,
    async (c) => {
      const sourceUrl = normalizeMarketplaceSource(c.req.valid('json').source)
      await c.var.marketplacePluginDelegate.addMarketplace({ sourceUrl })
      c.var.logger.info({ sourceUrl }, 'claude marketplace registered')
      // Serve the row from a re-read — the response proves the registration
      // landed in the CLI's registry (the add-custom-server precedent).
      const added = c.var
        .claudeMarketplacesReader()
        .find((source) => source.sourceUrl === sourceUrl)
      return c.json(
        added !== undefined
          ? {
              marketplaceName: added.marketplaceName,
              sourceUrl: added.sourceUrl,
              ownerName: added.ownerName,
              pluginCount: added.plugins.length,
            }
          : { marketplaceName: '', sourceUrl, ownerName: null, pluginCount: 0 },
        201,
      )
    },
  )
  .delete(
    '/:marketplaceName',
    describeRoute({
      tags: ['marketplace'],
      summary: 'Deregister a Claude plugin marketplace (its rows leave the shelf).',
      'x-sdk-name': 'marketplaceSources.remove',
      responses: {
        204: { description: 'Deregistered.' },
        404: { description: 'No registered marketplace with that name.' },
      },
    }),
    validator('param', SourceNameParamSchema),
    ...userScoped,
    async (c) => {
      const { marketplaceName } = c.req.valid('param')
      const known = c.var
        .claudeMarketplacesReader()
        .some((source) => source.marketplaceName === marketplaceName)
      if (!known) throw new NotFoundError('marketplace source', marketplaceName)
      await c.var.marketplacePluginDelegate.removeMarketplace({ marketplaceName })
      c.var.logger.info({ marketplaceName }, 'claude marketplace deregistered')
      return c.body(null, 204)
    },
  )
