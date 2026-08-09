// The mcp curation rule made structural (recorded as prose 2026-08-02:
// "two catalog items must never declare the same `serverName`"). The
// desktop's provenance marker stops cross-matching, but a second item
// claiming an installed name would still present a Get that can only
// ConflictError — with more sources feeding the catalog (the admin-hub
// aggregation arc), a human remembering the rule stops scaling; the
// publish wall is where it becomes a fact.
//
// Deliberate, narrow bend of "manifest opaque hub-side": exactly one
// string (`serverName`) is read, with the desktop's lenient posture — a
// missing or unreadable name skips the check (such a row never reaches
// the shelf anyway). Any-status comparison on purpose: a draft holds its
// name too, or publishing it later would be the collision.

import { ValidationError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import {
  findLatestVersionForItem,
  listAllItemsWithPublisher,
} from './repositories/catalog-repository.js'

export async function assertMcpServerNameUnique(
  db: CloudDatabase,
  input: { itemId: string; manifest: Record<string, unknown> },
): Promise<void> {
  const serverName = input.manifest.serverName
  if (typeof serverName !== 'string' || serverName.length === 0) return

  const otherMcpItems = (await listAllItemsWithPublisher(db)).filter(
    ({ item }) => item.kind === 'mcp' && item.itemId !== input.itemId,
  )
  for (const { item } of otherMcpItems) {
    const latest = await findLatestVersionForItem(db, item.itemId)
    if (latest === null) continue
    if (readServerName(latest.manifestJson) === serverName) {
      throw new ValidationError(
        `MCP server name '${serverName}' is already declared by catalog item ` +
          `'${item.itemId}' — two items must never share a serverName (they would ` +
          `claim the same config entry). Pick a distinct name or update that item.`,
      )
    }
  }
}

function readServerName(manifestJson: string): string | null {
  try {
    const parsed = JSON.parse(manifestJson) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const name = (parsed as Record<string, unknown>).serverName
    return typeof name === 'string' ? name : null
  } catch {
    return null
  }
}
