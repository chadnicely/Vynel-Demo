// Integration tests for the `/providers/...` routes. Full HTTP stack
// (route → userScoped → @vynel/providers status op). The routes read
// `c.var.aiProvider` (injected via `createApp({ aiProvider })`), so a FAKE
// provider threads through the whole stack — a real provider would read the
// dev machine's actual `~/.claude` install/auth state + on-disk skills at
// test time (skills `/synchronize` route-test precedent). The single local
// user is created by `userResolverMiddleware` on first request (users route
// tests' resolver-fallback convention).
//
// NOTE: these tests exercise the `app.route('/providers', providersApp)`
// mount in `app.ts` — they go green once the integrator applies it.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import type {
  AiAgentProvider,
  AuthenticationStatus,
  DiscoverSkillsInput,
  InstalledSkill,
} from '@vynel/providers'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

const fakeStatus: AuthenticationStatus = {
  providerId: 'claude',
  isInstalled: true,
  isAuthenticated: true,
  authenticatedAccountLabel: 'test@example.com',
  authenticationMethod: 'oauth',
  inactiveReason: null,
}

const fakeSkill: InstalledSkill = {
  providerId: 'claude',
  scope: 'user',
  skillName: 'email-drafter',
  displayDescription: 'Drafts emails in your voice',
  installLocation: '/fake/home/.claude/skills/email-drafter/SKILL.md',
  invocationSyntax: '/email-drafter',
}

// Only the two runtime reads these routes exercise are faked; the rest throw
// to signal misuse (mirrors the skills route test's makeFakeProvider). The
// recorded discover inputs prove the workspacePath query threading.
function makeFakeProvider(receivedDiscoverInputs: DiscoverSkillsInput[] = []): AiAgentProvider {
  return {
    providerId: 'claude' as const,
    getAuthenticationStatus: async () => fakeStatus,
    discoverInstalledSkills: async (input: DiscoverSkillsInput) => {
      receivedDiscoverInputs.push(input)
      return [fakeSkill]
    },
    listConfiguredMcpServers: async () => [],
    startChatSession: () => {
      throw new Error('not used in providers route tests')
    },
    respondToApprovalRequest: async () => {
      throw new Error('not used in providers route tests')
    },
    interruptChatSession: async () => {
      throw new Error('not used in providers route tests')
    },
    fetchPersistedSessionTranscript: async () => {
      throw new Error('not used in providers route tests')
    },
    synchronizePersistedSessions: async () => [],
    getContextReport: async () => null,
    summarizeSession: async () => null,
  } as AiAgentProvider
}

describe('providers routes', () => {
  describe('GET /providers', () => {
    it('returns a bare array with the injected provider status', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, aiProvider: makeFakeProvider() })
        const res = await app.request('/providers')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([fakeStatus])
      })
    })
  })

  describe('GET /providers/:providerId/auth', () => {
    it('returns the injected provider status as data', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, aiProvider: makeFakeProvider() })
        const res = await app.request('/providers/claude/auth')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(fakeStatus)
      })
    })

    it('returns 400 for a recognized-but-unregistered providerId (ValidationError mapping)', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, aiProvider: makeFakeProvider() })
        const res = await app.request('/providers/codex/auth')
        expect(res.status).toBe(400)
        const body = (await res.json()) as { code: string }
        expect(body.code).toBe('validation_failed')
      })
    })

    it('returns 400 for a providerId outside the enum (Zod validation)', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, aiProvider: makeFakeProvider() })
        const res = await app.request('/providers/not-a-provider/auth')
        expect(res.status).toBe(400)
      })
    })
  })

  describe('GET /providers/:providerId/skills', () => {
    it('returns the runtime-discovered skills with an empty discover input when no workspacePath', async () => {
      await withTestDatabase(async (db) => {
        const receivedDiscoverInputs: DiscoverSkillsInput[] = []
        const app = createApp({
          db,
          logger: silentLogger,
          aiProvider: makeFakeProvider(receivedDiscoverInputs),
        })
        const res = await app.request('/providers/claude/skills')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([fakeSkill])
        expect(receivedDiscoverInputs).toEqual([{}])
      })
    })

    it('threads the workspacePath query through to the provider', async () => {
      await withTestDatabase(async (db) => {
        const receivedDiscoverInputs: DiscoverSkillsInput[] = []
        const app = createApp({
          db,
          logger: silentLogger,
          aiProvider: makeFakeProvider(receivedDiscoverInputs),
        })
        const res = await app.request('/providers/claude/skills?workspacePath=%2Ftmp%2Facme')
        expect(res.status).toBe(200)
        expect(receivedDiscoverInputs).toEqual([{ workspacePath: '/tmp/acme' }])
      })
    })

    it('returns 400 for a recognized-but-unregistered providerId', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, aiProvider: makeFakeProvider() })
        const res = await app.request('/providers/gemini/skills')
        expect(res.status).toBe(400)
        const body = (await res.json()) as { code: string }
        expect(body.code).toBe('validation_failed')
      })
    })
  })
})
