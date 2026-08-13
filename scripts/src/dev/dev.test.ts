import { describe, expect, it } from 'vitest'
import { parseDevCommand } from './dev.js'

describe('parseDevCommand', () => {
  it('no apps = the classic default trio, hub DB included', () => {
    const command = parseDevCommand([])
    expect(command.filters).toEqual(['@vynel/cloud-api', '@vynel/local-api', '@vynel/local-web'])
    expect(command.needsDatabase).toBe(true)
    expect(command.portBase).toBeUndefined()
  })

  it('named apps resolve through aliases, deduped, and skip the DB when no hub app runs', () => {
    const command = parseDevCommand(['api', 'web', 'local-api'])
    expect(command.filters).toEqual(['@vynel/local-api', '@vynel/local-web'])
    expect(command.needsDatabase).toBe(false)
  })

  it('hub apps flip the database on', () => {
    expect(parseDevCommand(['admin']).needsDatabase).toBe(true)
    expect(parseDevCommand(['cloud', 'api']).needsDatabase).toBe(true)
  })

  it('--base sets the band; --port names the engine port and derives the same band', () => {
    expect(parseDevCommand(['api', '--base', '28890']).portBase).toBe(28_890)
    expect(parseDevCommand(['api', '--port', '28892']).portBase).toBe(28_890)
  })

  it('rejects unknown apps, unknown flags, both port flags, and bad values', () => {
    expect(() => parseDevCommand(['nope'])).toThrow(/unknown app/)
    expect(() => parseDevCommand(['--nope'])).toThrow(/unknown flag/)
    expect(() => parseDevCommand(['--base', '1', '--port', '2'])).toThrow(/not both/)
    expect(() => parseDevCommand(['--base'])).toThrow(/needs a value/)
    expect(() => parseDevCommand(['--port', 'abc'])).toThrow(/not a port number/)
    expect(() => parseDevCommand(['--base', 'abc'])).toThrow(/not a port number/)
    expect(() => parseDevCommand(['--base', ''])).toThrow(/not a port number/)
    expect(() => parseDevCommand(['--base', '65534'])).toThrow(/outside the valid port range/)
  })
})
