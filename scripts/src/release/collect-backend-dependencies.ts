// Walks the @vynel workspace closure from @vynel/local-api and collects every
// THIRD-PARTY runtime dependency. The payload bundles all @vynel code into one
// file, so the shipped node_modules holds only these — our source never lands
// in the payload. A name declared with two different ranges fails the build
// loudly: versions have one home in this repo, and a silent pick could ship a
// combination no test ever ran.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

type PackageManifest = {
  name: string
  dependencies?: Record<string, string>
}

// Directory names don't always match package names (@vynel/mcp lives in
// apps/mcp, @vynel/local-api in apps/local-api) — enumerate the real
// workspace dirs once and index manifests by their declared name.
function indexWorkspaceManifests(repoRoot: string): Map<string, PackageManifest> {
  const manifests = new Map<string, PackageManifest>()
  for (const workspaceDir of ['apps', 'packages']) {
    const parent = join(repoRoot, workspaceDir)
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestPath = join(parent, entry.name, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
      manifests.set(manifest.name, manifest)
    }
  }
  return manifests
}

export function collectBackendThirdPartyDependencies(repoRoot: string): Record<string, string> {
  const manifests = indexWorkspaceManifests(repoRoot)
  const ranges = new Map<string, string>()
  const conflicts: string[] = []
  const visited = new Set<string>()
  const queue = ['@vynel/local-api']

  while (queue.length > 0) {
    const packageName = queue.shift()!
    if (visited.has(packageName)) continue
    visited.add(packageName)

    const manifest = manifests.get(packageName)
    if (manifest === undefined) {
      throw new Error(`Workspace package ${packageName} not found under apps/ or packages/.`)
    }
    for (const [dependencyName, range] of Object.entries(manifest.dependencies ?? {})) {
      if (dependencyName.startsWith('@vynel/')) {
        queue.push(dependencyName)
        continue
      }
      const existing = ranges.get(dependencyName)
      if (existing !== undefined && existing !== range) {
        conflicts.push(`${dependencyName}: "${existing}" vs "${range}" (via ${packageName})`)
        continue
      }
      ranges.set(dependencyName, range)
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      'Backend dependency ranges disagree across workspace packages — align them ' +
        `before building a payload:\n  ${conflicts.join('\n  ')}`,
    )
  }

  return Object.fromEntries([...ranges.entries()].sort(([a], [b]) => a.localeCompare(b)))
}
