import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { downloadToFile, type DownloadProgress } from './download-to-file.js'
import { startLocalModelServer, withTempModelsDir, type LocalModelServer } from './test-support/index.js'

const BODY = Buffer.from('0123456789abcdef0123456789abcdef')

let server: LocalModelServer
beforeAll(async () => {
  server = await startLocalModelServer({ '/model.bin': BODY })
})
afterAll(() => server.close())

describe('downloadToFile', () => {
  it('streams the body to disk, creating the parent, and reports bytes against Content-Length', async () => {
    await withTempModelsDir(async (baseDir) => {
      const destination = join(baseDir, 'nested', 'model.bin')
      const ticks: DownloadProgress[] = []
      await downloadToFile(`${server.baseUrl}/model.bin`, destination, {
        onProgress: (progress) => ticks.push(progress),
      })

      expect(await readFile(destination)).toEqual(BODY)
      expect(ticks.length).toBeGreaterThanOrEqual(1)
      expect(ticks.at(-1)).toEqual({ bytes: BODY.length, total: BODY.length })
      // Monotonic — the screen's bar never runs backwards.
      for (let index = 1; index < ticks.length; index += 1) {
        expect(ticks[index]!.bytes).toBeGreaterThanOrEqual(ticks[index - 1]!.bytes)
      }
    })
  })

  it('rejects on a non-2xx with the status and the url in the message', async () => {
    await withTempModelsDir(async (baseDir) => {
      await expect(
        downloadToFile(`${server.baseUrl}/missing.bin`, join(baseDir, 'x.bin')),
      ).rejects.toThrow(/404 Not Found.*missing\.bin/)
    })
  })

  it('reports a null total when the server sends no Content-Length', async () => {
    await withTempModelsDir(async (baseDir) => {
      const headerless: typeof fetch = async () =>
        new Response(BODY, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
      const ticks: DownloadProgress[] = []
      await downloadToFile('http://unused/model.bin', join(baseDir, 'model.bin'), {
        fetch: headerless,
        onProgress: (progress) => ticks.push(progress),
      })
      expect(ticks.at(-1)).toEqual({ bytes: BODY.length, total: null })
    })
  })
})
