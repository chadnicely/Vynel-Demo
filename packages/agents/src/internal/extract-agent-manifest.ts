// Reads + validates `agent.json` out of a downloaded agent artifact (zip).
// We read ONLY the agent.json entry and never write archive paths to disk,
// so classic zip-slip is not a vector here — the guards below are
// defense-in-depth + a zip-bomb cap. The zod parse is the trust boundary
// between community bytes and a `CreateAgentInput` (manifests are opaque
// hub-side by design).
//
// SECURITY ORDERING (enforced by the caller): the artifact's sha256 is
// verified against the catalog's recorded hash BEFORE this runs.
//
// Second private zip extractor after skills' `extract-skill-archive.ts` —
// extract a shared home on the THIRD consumer (module notes, "Deferred").

import JSZip from 'jszip'
import { ValidationError } from '@vynel/errors'
import {
  AgentItemManifestSchema,
  type AgentItemManifest,
} from '@vynel/contracts/marketplace/agent-item-manifest'
import { readDeclaredUncompressedSize } from './read-declared-uncompressed-size.js'

const MAX_ENTRIES = 200
const MAX_MANIFEST_BYTES = 256 * 1024
// An agent artifact carries only a bytes-small agent.json, so 1 MB of raw
// archive is already generous. Nothing upstream bounds the download size,
// so capping the compressed input BEFORE loadAsync is the first zip-bomb
// wall — no attacker-controlled inflation happens on an oversized blob.
const MAX_ARTIFACT_BYTES = 1024 * 1024

export async function extractAgentManifest(artifact: Buffer): Promise<AgentItemManifest> {
  if (artifact.byteLength > MAX_ARTIFACT_BYTES) {
    throw new ValidationError('The downloaded agent artifact exceeds the size limit.')
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(artifact)
  } catch {
    throw new ValidationError('The downloaded agent artifact is not a valid archive.')
  }

  if (Object.keys(zip.files).length > MAX_ENTRIES) {
    throw new ValidationError('The agent artifact has too many entries.')
  }

  // agent.json must sit at the archive root, by convention (mirrors SKILL.md).
  const entry = zip.file('agent.json')
  if (entry === null) {
    throw new ValidationError('The agent artifact is missing agent.json.')
  }

  // Second wall: reject on the zip's own declared uncompressed size BEFORE
  // inflating, so a small archive declaring a huge entry never allocates.
  // If jszip hides the field, the input cap above still bounds the damage.
  const declaredSize = readDeclaredUncompressedSize(entry)
  if (declaredSize !== null && declaredSize > MAX_MANIFEST_BYTES) {
    throw new ValidationError('agent.json exceeds the size limit.')
  }

  // Post-inflate backstop — a lying declared size cannot sneak past.
  const raw = await entry.async('string')
  if (Buffer.byteLength(raw, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new ValidationError('agent.json exceeds the size limit.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ValidationError('agent.json is not valid JSON.')
  }

  const manifest = AgentItemManifestSchema.safeParse(parsed)
  if (!manifest.success) {
    const issue = manifest.error.issues[0]
    throw new ValidationError(
      `agent.json is not a valid agent manifest (${issue?.path.join('.') ?? 'manifest'}: ${issue?.message ?? 'invalid'}) — ask the publisher to fix and re-publish.`,
    )
  }
  return manifest.data
}
