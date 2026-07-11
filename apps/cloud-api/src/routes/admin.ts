// The /admin surface — accounts provisioning/roles + the catalog lifecycle
// (cloud-admin-web's backend, also driven by the publish CLI). Guarded by the
// dual-door `requireAdminAccess` (static CLOUD_ADMIN_TOKEN bearer OR a
// signed-in admin-role account, role read FRESH). Thin: routes only decode
// transport; every rule lives in `@vynel/registry` / `@vynel/accounts`.

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { assignAccountRole, createProvisionedAccount } from '@vynel/accounts'
import {
  PublishItemSchema,
  publishCatalogArtifact,
  listCatalogForAdmin,
  updateCatalogItemMetadata,
  setCatalogItemLifecycleStatus,
  UpdateCatalogItemMetadataSchema,
  CatalogItemStatusSchema,
} from '@vynel/registry'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { jsonValidator } from '../middleware/json-validator.js'
import { requireAdminAccess } from '../middleware/require-admin.js'

const CreateAccountSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(120),
  platformUserId: z.string().min(1).max(120).optional(),
})

// Base64 inflates ~4/3; the JSON wrapper adds a little. 16MB covers the
// registry's 10MB artifact cap with headroom.
const MAX_PUBLISH_BODY_BYTES = 16 * 1024 * 1024

const PublishRequestSchema = PublishItemSchema.extend({
  // The artifact zip, base64-encoded (curated items are small — inline JSON
  // beats multipart for a v1 admin CLI).
  artifactBase64: z.string().min(1),
})

export function buildAdminRoutes(options: CloudAppOptions) {
  const linkDeps = {
    mail: options.mail,
    linkBaseUrl: options.linkBaseUrl,
    ...(options.now !== undefined ? { now: options.now } : {}),
  }
  return new Hono()
    .use(
      '*',
      requireAdminAccess({
        adminToken: options.adminToken,
        accessTokenVerifier: options.accessTokenVerifier,
        db: options.db,
      }),
    )
    .post('/accounts', jsonValidator(CreateAccountSchema), async (c) => {
      const body = c.req.valid('json')
      // exactOptionalPropertyTypes: spread the optional only when present.
      const { accountId } = await createProvisionedAccount(
        options.db,
        {
          email: body.email,
          displayName: body.displayName,
          ...(body.platformUserId !== undefined ? { platformUserId: body.platformUserId } : {}),
        },
        linkDeps,
      )
      return c.json({ accountId }, 201)
    })
    .post(
      '/accounts/:accountId/role',
      jsonValidator(z.object({ role: z.enum(['member', 'admin']) })),
      async (c) => {
        const accountId = c.req.param('accountId')
        const { role } = c.req.valid('json')
        await assignAccountRole(options.db, { accountId, role })
        return c.json({ accountId, role })
      },
    )
    .get('/catalog', async (c) => {
      const items = await listCatalogForAdmin(options.db)
      return c.json({ items })
    })
    .patch(
      '/catalog/:itemId',
      jsonValidator(UpdateCatalogItemMetadataSchema),
      async (c) => {
        const itemId = c.req.param('itemId')
        await updateCatalogItemMetadata(options.db, itemId, c.req.valid('json'))
        return c.json({ itemId })
      },
    )
    .post(
      '/catalog/:itemId/status',
      jsonValidator(z.object({ status: CatalogItemStatusSchema })),
      async (c) => {
        const itemId = c.req.param('itemId')
        const { status } = c.req.valid('json')
        await setCatalogItemLifecycleStatus(options.db, { itemId, status })
        return c.json({ itemId, status })
      },
    )
    .post(
      '/catalog/publish',
      bodyLimit({ maxSize: MAX_PUBLISH_BODY_BYTES }),
      jsonValidator(PublishRequestSchema),
      async (c) => {
        const { artifactBase64, ...item } = c.req.valid('json')
        const result = await publishCatalogArtifact(options.db, options.artifactStore, {
          ...item,
          artifactBytes: Buffer.from(artifactBase64, 'base64'),
        })
        return c.json(result, 201)
      },
    )
}
