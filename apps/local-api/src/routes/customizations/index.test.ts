// Integration tests for `/customizations` — the boot read + the two whole-row
// writes, through createApp (DI + onError + userScoped resolution).

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

const scopeBody = {
  colorSlot: null,
  customColor: '#1e90ff',
  personaColorSlot: 2,
  personaCustomColor: null,
  personaImage: null,
  workspaceImage: 'data:image/png;base64,iVBORw0KGgo=',
  groups: [{ id: 'toolkit', label: 'Toolkit' }],
  entries: [{ sectionId: 'agents', groupId: 'toolkit', isHidden: true }],
}

function put(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('customizations routes', () => {
  it('starts empty; a saved scope and a saved tree layout come back from the boot read', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })

      const empty = await app.request('/customizations')
      expect(empty.status).toBe(200)
      expect(await empty.json()).toEqual({ scopes: [], treeLayout: null })

      const savedScope = await put(app, '/customizations/scopes/ws-1', scopeBody)
      expect(savedScope.status).toBe(200)
      expect(await savedScope.json()).toEqual({ scopeKey: 'ws-1', ...scopeBody })

      const layout = { groups: ['g1'], workspaces: { g1: ['ws-1'], root: [] } }
      expect((await put(app, '/customizations/tree-layout', layout)).status).toBe(200)

      const all = await app.request('/customizations')
      expect(await all.json()).toEqual({ scopes: [{ scopeKey: 'ws-1', ...scopeBody }], treeLayout: layout })
    })
  })

  it('answers a bad colour with a 400 on the error contract', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const res = await put(app, '/customizations/scopes/global', { ...scopeBody, customColor: 'blue' })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { code: string }).code).toBe('validation_failed')
    })
  })
})
