import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalModelEntry } from '@vynel/contracts/models/local-model-catalog'

// Test doubles for the models leaf and whoever composes it: a throwaway models
// dir, catalog-shaped entries that point at a local HTTP server, and the server
// itself — real streams over loopback, nothing mocked.

export async function withTempModelsDir<T>(run: (baseDir: string) => Promise<T>): Promise<T> {
  const baseDir = await mkdtemp(join(tmpdir(), 'vynel-models-'))
  try {
    return await run(baseDir)
  } finally {
    await rm(baseDir, { recursive: true, force: true })
  }
}

export interface LocalModelServer {
  readonly baseUrl: string
  close(): Promise<void>
}

/** Serves `routes[path]` bytes with a Content-Length; anything else is a 404. */
export async function startLocalModelServer(
  routes: Record<string, Buffer>,
): Promise<LocalModelServer> {
  const server: Server = createServer((request, response) => {
    const body = routes[request.url ?? '']
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
    })
    // Two chunks so a progress observer sees more than one tick.
    const half = Math.ceil(body.length / 2)
    response.write(body.subarray(0, half))
    response.end(body.subarray(half))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

/** A single-file model (the silero shape) served from `baseUrl`. */
export function fakeFileModel(baseUrl: string, id = 'fake-vad'): LocalModelEntry {
  return {
    id,
    kind: 'vad',
    label: 'Fake VAD',
    description: 'A test model.',
    approxBytes: 16,
    folder: id,
    source: { format: 'file', url: `${baseUrl}/${id}.onnx` },
    layout: { family: 'silero', model: `${id}.onnx` },
  }
}

/** An archive model (the piper shape) served from `baseUrl`. */
export function fakeArchiveModel(baseUrl: string, id = 'fake-tts'): LocalModelEntry {
  return {
    id,
    kind: 'tts',
    label: 'Fake TTS',
    description: 'A test model.',
    approxBytes: 32,
    folder: id,
    source: { format: 'archive', url: `${baseUrl}/${id}.tar.bz2` },
    layout: {
      family: 'vits',
      model: 'model.onnx',
      tokens: 'tokens.txt',
      dataDir: 'espeak-ng-data',
      sampleRate: 22_050,
    },
    speakers: [{ id: 0, name: 'Test', accent: 'American', gender: 'female' }],
  }
}
