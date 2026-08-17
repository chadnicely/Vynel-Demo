// Drift guards for the declared catalog: one entry per toolName with merged
// surfaces, gate inversion faithful to the real maps, curated card defaults.

import { describe, expect, it } from 'vitest'
import { desktopFeatureDescriptor } from '@vynel/desktop-control'
import { buildSessionToolCatalog, SURFACE_DESCRIPTOR_SETS } from './session-tool-catalog.js'

const catalog = buildSessionToolCatalog({
  desktopToolNames: desktopFeatureDescriptor.toolNames ?? [],
})

describe('buildSessionToolCatalog', () => {
  it('emits exactly one entry per toolName (duplicate-name surfaces pre-merged)', () => {
    const names = catalog.map((entry) => entry.toolName)
    expect(new Set(names).size).toBe(names.length)
    // send_message rides the workspace AND routing arrays — its one entry
    // must carry both worlds' surfaces (the resolver's precondition).
    const sendMessage = catalog.find((entry) => entry.toolName === 'mcp__vynel__send_message')!
    expect(sendMessage.surfaces).toEqual(
      expect.arrayContaining(['workspace-interactive', 'schedule', 'global-interactive']),
    )
  })

  it('inverts the gate maps faithfully (tier + capability per tool)', () => {
    const runSsh = catalog.find((entry) => entry.toolName === 'mcp__vynel-ssh__run_ssh_command')!
    expect(runSsh.featureKey).toBe('ssh')
    const listApps = catalog.find((entry) => entry.toolName === 'mcp__vynel__list_apps')!
    expect(listApps.featureKey).toBe('apps')
    const speak = catalog.find((entry) => entry.toolName === 'mcp__vynel__speak')!
    expect(speak.featureKey).toBe('voice')
    const listTasks = catalog.find((entry) => entry.toolName === 'mcp__vynel__list_tasks')!
    expect(listTasks.capabilityId).toBe('tasks')
    const playbooks = catalog.find(
      (entry) => entry.toolName === 'mcp__vynel-notebook__list_playbooks',
    )!
    expect(playbooks.capabilityId).toBe('notebook')
  })

  it('defaults the curated tier to ask-card and everything else to never', () => {
    expect(catalog.find((e) => e.toolName === 'mcp__vynel__delete_agent')!.cardClass).toBe('ask')
    expect(
      catalog.find((e) => e.toolName === 'mcp__desktop__propose_desktop_plan')!.cardClass,
    ).toBe('ask')
    expect(catalog.find((e) => e.toolName === 'mcp__vynel__list_tasks')!.cardClass).toBe('never')
  })

  it("ask_user's surfaces match the map — interactive + the bounded channel turn", () => {
    // The regression that shipped inert: the ask slice attached the server to
    // channel turns while the catalog still excluded the surface, so the
    // policy layer denied the very tool the turn composed.
    const askUser = catalog.find((entry) => entry.toolName === 'mcp__vynel-ask__ask_user')!
    expect([...askUser.surfaces].sort()).toEqual(
      ['global-channel', 'global-interactive', 'workspace-interactive'].sort(),
    )
    expect(SURFACE_DESCRIPTOR_SETS['global-channel']).toContain('vynel-ask')
  })

  it("whoami rides EVERY surface — self-knowledge is every session's (continuity arc)", () => {
    const whoami = catalog.find((entry) => entry.toolName === 'mcp__vynel-session__whoami')!
    expect([...whoami.surfaces].sort()).toEqual([...Object.keys(SURFACE_DESCRIPTOR_SETS)].sort())
    for (const servers of Object.values(SURFACE_DESCRIPTOR_SETS)) {
      expect(servers).toContain('vynel-session')
    }
    expect(whoami.cardClass).toBe('never')
  })

  it('covers every server the surface map names', () => {
    const serversInMap = new Set(Object.values(SURFACE_DESCRIPTOR_SETS).flat())
    const serversInCatalog = new Set(catalog.map((entry) => entry.serverName))
    for (const server of serversInMap) {
      expect(serversInCatalog, server).toContain(server)
    }
  })

  it("spawning tools ride 'spawned' — a spawned session keeps its parent's toolset (Chad 2026-07-26)", () => {
    // The delegated spawned-session turn composes the INTERACTIVE variant;
    // stripping create_session/list_sessions there would silently reverse
    // the recorded two-hop-chains decision.
    const createSession = catalog.find((entry) => entry.toolName === 'mcp__vynel__create_session')!
    expect(createSession.surfaces).toEqual(
      expect.arrayContaining(['workspace-interactive', 'spawned', 'agent']),
    )
  })

  it('routing-only tools attach to no workspace surface; workspace-only to no global one', () => {
    const registerWorkspace = catalog.find(
      (entry) => entry.toolName === 'mcp__vynel__register_workspace',
    )!
    expect(registerWorkspace.surfaces).not.toContain('workspace-interactive')
    const listApps = catalog.find((entry) => entry.toolName === 'mcp__vynel__list_apps')!
    expect(listApps.surfaces).not.toContain('global-interactive')
  })
})
