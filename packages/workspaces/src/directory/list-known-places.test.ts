import { describe, it, expect } from 'vitest'
import { realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import { listKnownPlaces } from './list-known-places.js'

describe('listKnownPlaces', () => {
  it('starts with home and only lists folders that exist', async () => {
    const places = await listKnownPlaces()

    expect(places[0]).toEqual({
      kind: 'home',
      name: expect.any(String),
      path: realpathSync(os.homedir()),
    })
    for (const place of places) {
      expect(statSync(place.path).isDirectory()).toBe(true)
    }
  })

  it('lists each place kind at most once, in the Explorer rail order', async () => {
    const places = await listKnownPlaces()
    const kinds = places.map((place) => place.kind)
    const order = ['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos']

    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds).toEqual(order.filter((kind) => kinds.includes(kind as (typeof kinds)[number])))
  })
})
