// Prunes the payload's node_modules of provably-dead weight. The install-time
// pain scales with FILE COUNT (NSIS writes one by one, Defender scans each),
// and the download with bytes — both dominated by files our Node runtime can
// never load:
//
//   onnxruntime-node   ships binaries for six platforms; we run exactly one.
//   onnxruntime-web    Node's export condition resolves ort.node.min.* ONLY —
//                      the wasm blobs and browser/webgpu bundles are dead.
//   transformers       same shape: transformers.node.{mjs,cjs} are the Node
//                      entries; web bundles, wasm copies, src/ are dead.
//   pdf-parse          ships its test corpus (hundreds of PDFs).
//   @types/*, *.d.ts, *.map, zod/src   never loaded at runtime.
//
// The claude-agent-sdk packages are EXCLUDED from all pruning — the SDK spawns
// its CLI from its own files and owns its layout. verify-payload.ts asserts
// the kept entries still exist after pruning; the smoke boot proves the rest.

import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { PayloadTarget } from './payload-targets.js'

type PruneReport = { removedFiles: number; removedBytes: number }

function fileCountAndBytes(path: string): { files: number; bytes: number } {
  const stats = statSync(path)
  if (!stats.isDirectory()) return { files: 1, bytes: stats.size }
  let files = 0
  let bytes = 0
  for (const entry of readdirSync(path)) {
    const child = fileCountAndBytes(join(path, entry))
    files += child.files
    bytes += child.bytes
  }
  return { files, bytes }
}

function remove(path: string, report: PruneReport): void {
  let counted
  try {
    counted = fileCountAndBytes(path)
  } catch (error) {
    // Absent is expected (per-target package variation); anything else —
    // EPERM/EBUSY from a Defender scan — must fail the build, or an
    // un-pruned installer ships with no signal (verify only guards over-prune).
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  rmSync(path, { recursive: true, force: true })
  report.removedFiles += counted.files
  report.removedBytes += counted.bytes
}

/** Delete every entry in `directory` whose name fails the keep predicate. */
function keepOnly(directory: string, keep: (name: string) => boolean, report: PruneReport): void {
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch (error) {
    // Same contract as remove(): only true absence passes silently.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  for (const name of names) {
    if (!keep(name)) remove(join(directory, name), report)
  }
}

const DEAD_FILE_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts', '.js.map', '.mjs.map', '.cjs.map', '.ts.map']

function pruneDeadFileClasses(directory: string, report: PruneReport): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      // The agent SDK owns its layout — never reach into it.
      if (entry.name.startsWith('claude-agent-sdk')) continue
      pruneDeadFileClasses(entryPath, report)
      continue
    }
    if (DEAD_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      remove(entryPath, report)
    }
  }
}

export function prunePayloadNodeModules(backendDir: string, target: PayloadTarget): PruneReport {
  const nodeModulesDir = join(backendDir, 'node_modules')
  const report: PruneReport = { removedFiles: 0, removedBytes: 0 }

  // 1. onnxruntime-node: keep only this target's binary directory.
  const napiDir = join(nodeModulesDir, 'onnxruntime-node', 'bin', 'napi-v3')
  keepOnly(napiDir, (osName) => osName === target.os, report)
  keepOnly(join(napiDir, target.os), (cpuName) => cpuName === target.cpu, report)

  // 2. onnxruntime-web: Node resolves ort.node.min.* — everything else in
  //    dist (wasm, browser/webgpu bundles, maps) is unreachable.
  keepOnly(join(nodeModulesDir, 'onnxruntime-web', 'dist'), (name) => name.startsWith('ort.node.'), report)

  // 3. transformers: keep the Node entries; drop web bundles, bundled wasm,
  //    maps, and the unbundled src/ (exports map bypasses `main`).
  keepOnly(
    join(nodeModulesDir, '@huggingface', 'transformers', 'dist'),
    (name) => name.startsWith('transformers.node.') && !name.endsWith('.map'),
    report,
  )
  remove(join(nodeModulesDir, '@huggingface', 'transformers', 'src'), report)

  // 4. pdf-parse ships its test corpus.
  remove(join(nodeModulesDir, 'pdf-parse', 'test'), report)

  // 5. Types packages and shipped TS source nothing compiles at runtime.
  remove(join(nodeModulesDir, '@types'), report)
  remove(join(nodeModulesDir, 'zod', 'src'), report)

  // 6. Declaration files + sourcemaps across the tree (drizzle alone carries
  //    ~1.8k of them).
  pruneDeadFileClasses(nodeModulesDir, report)

  return report
}

export function formatPruneReport(report: PruneReport): string {
  const megabytes = Math.round(report.removedBytes / (1024 * 1024))
  return `${report.removedFiles} files, ${megabytes} MB`
}
