// Verifies the dialect helpers compose into a valid SQLite table. Drizzle
// column builders aren't standalone-testable in a meaningful way — the
// most useful assertion is that `table(...)` with the helpers produces a
// table whose runtime columns carry the right notNull + type flags. Per
// `docs/blueprints/users/blueprint.md §16 step 2` + `.claude/rules/
// data-standard.md` "Helper contracts".

import { describe, it, expect } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { table, id, text, timestamp, boolean, json, bytes } from './dialect.js'

describe('dialect helpers', () => {
  it('compose into a valid SQLite table with the expected column shape', () => {
    const probe = table('_dialect_probe', {
      id: id().primaryKey(),
      name: text().notNull(),
      flag: boolean().notNull(),
      seenAt: timestamp().notNull(),
      payload: json<{ x: number }>(),
      blob: bytes(),
    })

    const config = getTableConfig(probe)
    expect(config.name).toBe('_dialect_probe')

    const columns = Object.fromEntries(config.columns.map((c) => [c.name, c]))
    expect(columns.id).toBeDefined()
    expect(columns.name).toBeDefined()
    expect(columns.flag).toBeDefined()
    expect(columns.seenAt).toBeDefined()
    expect(columns.payload).toBeDefined()
    expect(columns.blob).toBeDefined()

    // id() returns notNull (the helper applies .notNull() before returning)
    expect(columns.id?.notNull).toBe(true)
    // id() is a text column under SQLite
    expect(columns.id?.columnType).toBe('SQLiteText')
    // timestamp() and boolean() ride on SQLite's integer column with a mode
    expect(columns.seenAt?.columnType).toBe('SQLiteTimestamp')
    expect(columns.flag?.columnType).toBe('SQLiteBoolean')
    expect(columns.payload?.columnType).toBe('SQLiteTextJson')
    // bytes() rides on SQLite's blob column with mode 'buffer' — added with
    // the `memory` domain (D18) for serialized embedding storage.
    expect(columns.blob?.columnType).toBe('SQLiteBlobBuffer')
    // bytes() is nullable by default — the embedding lands later via the
    // worker, so the column needs to permit null until then.
    expect(columns.blob?.notNull).toBe(false)
  })
})
