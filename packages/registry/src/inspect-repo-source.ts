// The publish-from-repo PREVIEW: clone the pinned folder and tell the portal
// what it would be publishing — the parsed `vynel-item.json` when the folder
// carries one (the form prefills metadata/credits/version from it), or the
// detected entry file + kind guess when it doesn't. Read-only: nothing is
// stored, nothing is published.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ValidationError } from '@vynel/errors'
import { ENTRY_FILE_BY_KIND, ITEM_METADATA_FILE, type PackableItemKind } from './pack-item-folder.js'
import {
  RepoSourceSchema,
  assertGithubRepoUrl,
  deriveRepoSourceUrl,
  realRepoGitDeps,
  withClonedRepoSource,
  type RepoGitDeps,
} from './repo-source.js'

export const InspectRepoSourceSchema = RepoSourceSchema

export type InspectRepoSourceInput = z.infer<typeof InspectRepoSourceSchema>

// A LENIENT read of vynel-item.json — every field optional, unknown keys
// dropped: the file is a prefill aid, not the publish gate (the strict
// `PublishItemSchema` still validates the eventual publish body).
const LenientItemManifestSchema = z
  .object({
    publisher: z
      .object({
        id: z.string().max(80).optional(),
        name: z.string().max(120).optional(),
        tier: z.enum(['verified', 'anthropic-official', 'community']).optional(),
        url: z.string().max(400).nullable().optional(),
      })
      .optional(),
    item: z
      .object({
        itemId: z.string().max(120).optional(),
        kind: z.enum(['skill', 'agent', 'mcp', 'rule', 'plugin']).optional(),
        displayName: z.string().max(120).optional(),
        oneLineDescription: z.string().max(280).optional(),
        category: z.string().max(60).optional(),
        iconName: z.string().max(60).optional(),
        recommendedScope: z.enum(['user', 'workspace', 'both']).nullable().optional(),
        sourceUrl: z.string().max(400).nullable().optional(),
        minimumTier: z.enum(['basic', 'pro']).optional(),
        status: z.enum(['draft', 'published']).optional(),
      })
      .optional(),
    version: z
      .object({
        version: z.string().max(40).optional(),
        changelog: z.string().max(4000).optional(),
        manifest: z.record(z.unknown()).optional(),
        minAppVersion: z.string().max(40).nullable().optional(),
      })
      .optional(),
  })
  .strip()

export type RepoItemManifestPrefill = z.infer<typeof LenientItemManifestSchema>

export interface InspectRepoSourceResult {
  readonly resolvedSha: string
  /** The credit link the publish would default to. */
  readonly sourceUrl: string
  /** Parsed vynel-item.json (lenient), or null when the folder has none. */
  readonly manifest: RepoItemManifestPrefill | null
  /** Kind guessed from the entry file on disk; null when nothing matched. */
  readonly detectedKind: PackableItemKind | null
  readonly entryFile: string | null
}

export async function inspectRepoSource(
  input: InspectRepoSourceInput,
  deps: RepoGitDeps = realRepoGitDeps,
): Promise<InspectRepoSourceResult> {
  assertGithubRepoUrl(input.url)

  return withClonedRepoSource(input, deps, async (clone) => {
    const sourceUrl = deriveRepoSourceUrl(input.url, clone.resolvedSha, clone.subpath)

    const manifestRaw = await readFile(join(clone.folder, ITEM_METADATA_FILE), 'utf8').catch(
      () => null,
    )
    let manifest: RepoItemManifestPrefill | null = null
    if (manifestRaw !== null) {
      let parsed: unknown
      try {
        parsed = JSON.parse(manifestRaw)
      } catch {
        throw new ValidationError(
          `${ITEM_METADATA_FILE} in the repo folder is not valid JSON — fix it or remove it.`,
        )
      }
      const lenient = LenientItemManifestSchema.safeParse(parsed)
      manifest = lenient.success ? lenient.data : null
    }

    let detectedKind: PackableItemKind | null = null
    let entryFile: string | null = null
    for (const [kind, candidate] of Object.entries(ENTRY_FILE_BY_KIND)) {
      const exists = await readFile(join(clone.folder, candidate), 'utf8').then(
        () => true,
        () => false,
      )
      if (exists) {
        detectedKind = kind as PackableItemKind
        entryFile = candidate
        break
      }
    }

    return { resolvedSha: clone.resolvedSha, sourceUrl, manifest, detectedKind, entryFile }
  })
}
