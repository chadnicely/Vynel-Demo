import { describe, expect, it } from 'vitest'
import {
  VYNEL_CLOUD_ADMIN_WEB_PORT,
  VYNEL_CLOUD_API_PORT,
  VYNEL_ENGINE_PORT,
  VYNEL_LOCAL_WEB_PORT,
  VYNEL_PORT_BASE_DEFAULT,
  VYNEL_VOICE_DAEMON_PORT,
  parseVynelPortBase,
  resolveVynelPorts,
} from './ports.js'

describe('resolveVynelPorts', () => {
  it('the canonical literals ARE the default band — literals and derivation can never drift', () => {
    const ports = resolveVynelPorts()
    expect(ports.cloudApi).toBe(VYNEL_CLOUD_API_PORT)
    expect(ports.cloudAdminWeb).toBe(VYNEL_CLOUD_ADMIN_WEB_PORT)
    expect(ports.engine).toBe(VYNEL_ENGINE_PORT)
    expect(ports.voiceDaemon).toBe(VYNEL_VOICE_DAEMON_PORT)
    expect(ports.localWeb).toBe(VYNEL_LOCAL_WEB_PORT)
  })

  it('shifts the whole band coherently from one base', () => {
    const ports = resolveVynelPorts(28_890)
    expect(ports).toEqual({
      cloudApi: 28_890,
      cloudAdminWeb: 28_891,
      engine: 28_892,
      voiceDaemon: 28_893,
      localWeb: 28_894,
    })
  })
})

describe('parseVynelPortBase', () => {
  it('unset and empty fall back to the canonical base', () => {
    expect(parseVynelPortBase(undefined)).toBe(VYNEL_PORT_BASE_DEFAULT)
    expect(parseVynelPortBase('')).toBe(VYNEL_PORT_BASE_DEFAULT)
  })

  it('coerces a numeric string', () => {
    expect(parseVynelPortBase('28890')).toBe(28_890)
  })

  it('rejects garbage and bands that would overflow the port space', () => {
    expect(() => parseVynelPortBase('not-a-port')).toThrow()
    expect(() => parseVynelPortBase('0')).toThrow()
    expect(() => parseVynelPortBase('65534')).toThrow()
  })
})
