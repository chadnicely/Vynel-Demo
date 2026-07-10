// The /admin fallback surface — manual account provisioning + catalog
// publishing until real admin tooling lands. Guarded by the CLOUD_ADMIN_TOKEN
// bearer.

import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { ConflictError, ValidationError } from '@vynel/errors'
import { createProvisionedAccount } from '@vynel/accounts'
import { PublishItemSchema, publishItemVersion, findItemVersion } from '@vynel/registry'
import type { CloudAppOptions } from '../cloud-app-options.js'
import { requireAdminToken } from '../middleware/require-admin.js'
import { artifactKey } from '../artifacts/artifact-store.js'

const CreateAccountSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(120),
  platformUserId: z.string().min(1).max(120).optional(),
})

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
// Base64 inflates ~4/3; the JSON wrapper adds a little. 16MB covers a 10MB
// artifact with headroom.
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
    .use('*', requireAdminToken(options.adminToken))
    .post('/accounts', zValidator('json', CreateAccountSchema), async (c) => {
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
      '/catalog/publish',
      bodyLimit({ maxSize: MAX_PUBLISH_BODY_BYTES }),
      zValidator('json', PublishRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        const bytes = Buffer.from(body.artifactBase64, 'base64')
        if (bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES) {
          throw new ValidationError('Artifact is empty or exceeds the 10MB limit.')
        }
        const artifactSha256 = createHash('sha256').update(bytes).digest('hex')
        // Conflict-check BEFORE the put: versions are byte-immutable. Storing
        // first would overwrite an existing version's bytes even though the
        // DB write is then refused with 409 — leaving stored bytes that no
        // longer match the recorded sha256 (M4b's install would reject them).
        const existing = await findItemVersion(options.db, {
          itemId: body.item.itemId,
          version: body.version.version,
        })
        if (existing !== null) {
          throw new ConflictError(
            `${body.item.itemId}@${body.version.version} is already published — bump the version.`,
          )
        }
        await options.artifactStore.put(
          artifactKey(body.item.itemId, body.version.version),
          bytes,
        )
        const result = await publishItemVersion(options.db, body, {
          artifactSha256,
          artifactSize: bytes.length,
        })
        return c.json(result, 201)
      },
    )
}
