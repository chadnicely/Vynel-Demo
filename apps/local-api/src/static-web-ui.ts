// Serves the BUILT local-web bundle from the daemon process — sidecar mode,
// where no Vite dev server fronts the api and the Tauri shell's windows load
// straight from us. Hand-rolled instead of @hono/node-server's `serveStatic`
// because that helper resolves `root` against process.cwd(); the daemon must
// serve an ABSOLUTE dist dir regardless of where the process was launched
// (the same per-CWD bug class the env.ts DB_PATH note records).

import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extname, resolve, sep } from 'node:path'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Resolve a request path to a real file inside `distDir`, or null. Null on
 * traversal attempts (`..`, encoded or plain), null bytes, undecodable paths,
 * and anything that isn't an existing regular file — the caller falls through
 * to the SPA fallback / api passthrough instead of erroring.
 */
export function resolveWebUiFilePath(distDir: string, requestPath: string): string | null {
  // Hono's req.path arrives percent-decoded once (URL parsing also collapses
  // plain `..` dot-segments there). This SECOND decode turns a double-encoded
  // traversal (`%252e%252e` → arrives here as `%2e%2e`) into a literal `..`
  // that resolve() collapses and the containment guard below rejects. Side
  // effect: a dist file with a literal `%` in its name is unservable —
  // irrelevant for a Vite build.
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const resolved = resolve(distDir, decoded.replace(/^\/+/, ''))
  // Containment guard: `resolve` collapses any `..` segments, so a path that
  // escaped the dist dir no longer starts with it.
  if (resolved !== distDir && !resolved.startsWith(distDir + sep)) return null

  if (!existsSync(resolved)) return null
  if (!statSync(resolved).isFile()) return null
  return resolved
}

/** Stream one resolved dist file. Vite content-hashes everything under
 * `assets/`, so those get immutable caching; entry files (index.html) must
 * revalidate or a stale shell outlives a rebuilt bundle. */
export function respondWithWebUiFile(distDir: string, filePath: string): Response {
  const fileExtension = extname(filePath).toLowerCase()
  const contentType = CONTENT_TYPES[fileExtension] ?? 'application/octet-stream'
  const isHashedAsset = filePath.startsWith(resolve(distDir, 'assets') + sep)

  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'content-length': String(statSync(filePath).size),
      'cache-control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  })
}
