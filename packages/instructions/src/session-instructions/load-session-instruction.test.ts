// Load-bearing guards for the always-on session instructions (migrated here from
// `@vynel/session`'s global-root-instructions.test.ts when the prompts became
// editable markdown). LLM-native routing only works if the global-root prompt
// names the routing tools — these fail loudly if an edit to the .md drops one.

import { describe, it, expect } from 'vitest'
import {
  loadSessionInstruction,
  type SessionInstructionId,
} from './load-session-instruction.js'

describe('loadSessionInstruction', () => {
  // test: correct expectation for the base+kind split — the operating rules
  // (plain language, approvals, real schedules, duty book) moved from the kind
  // files into the shared text base; the kind files keep only what the kind is.
  it('base states the operating rules every text session carries', () => {
    const prompt = loadSessionInstruction('base')
    expect(prompt).toContain('no jargon')
    expect(prompt).toContain('approval card')
    // The real-schedule discipline (never a simulated timer) — an unframed
    // schedule ask once produced a sleep timer; the rule is base material.
    expect(prompt).toContain('real schedule with the schedule tool')
    expect(prompt).toContain('simulate one with sleep')
    // The assistant is Claude, working through Vynel — the runtime stays out of the user's view.
    expect(prompt).toContain('Vynel')
    expect(prompt).toContain('You are Claude')
    // Every kind has a duty book — the base carries the pointer once.
    expect(prompt).toContain('read_playbook')
    expect(prompt).toContain('whoami')
    // UI-LOAD-BEARING (transcript collapse): the step-narration shape — one
    // short line before each batch of tool calls, no text between them — is
    // what gives the chat UI its boundary for collapsing tool-call runs under
    // the step line. Dropping it silently breaks the collapsed transcript.
    expect(prompt).toContain('ONE short line')
    expect(prompt).toContain('no text between them')
    // Example-first communication (show, in markdown, over long explanation).
    expect(prompt).toContain('markdown')
  })

  it('global-root names all four routing tools and frames the brain as a router', () => {
    const prompt = loadSessionInstruction('global-root')
    expect(prompt).toContain('list_routing_workspaces')
    expect(prompt).toContain('send_task_to_workspace')
    expect(prompt).toContain('list_routing_channels')
    expect(prompt).toContain('send_to_channel')
    expect(prompt.toLowerCase()).toContain('route')
  })

  // test: correct expectation for the base+kind split — plain-language and the
  // approval rule now live in base; the kind file states what this session IS:
  // the workspace's MANAGER (the primary runs the work and manages children).
  it('workspace-manager frames the primary as the workspace manager', () => {
    const prompt = loadSessionInstruction('workspace-manager')
    expect(prompt).toContain('Workspace Manager')
    expect(prompt).toContain('child session')
    // Sending a task to a child means sending instructions with it.
    expect(prompt).toContain('goes into its task')
    // The merge discipline (Kafi 2026-08-25): children live in worktrees;
    // the MANAGER merges into main and removes the worktree — never a child.
    expect(prompt).toContain('worktree')
    expect(prompt).toContain('merge')
    expect(prompt).toContain('Maintainer')
  })

  it('spawned-session frames the child and its working discipline', () => {
    const prompt = loadSessionInstruction('spawned-session')
    expect(prompt).toContain('CHILD session')
    expect(prompt).toContain('instructions')
    // The working discipline (Kafi 2026-08-25): context first, own worktree
    // (the merge is the manager's), and the review gate is a FRESH agent with
    // no conversation context; small tasks skip the ceremony.
    expect(prompt).toContain('worktree')
    expect(prompt).toContain('FRESH review agent')
    expect(prompt).toContain('skips the ceremony')
    // The report protocol rides the task steer, and chat text reaches no one.
    expect(prompt).toContain('reaches no one')
  })

  it('workspace-session frames the plain session and defers coordination to the manager', () => {
    const prompt = loadSessionInstruction('workspace-session')
    expect(prompt).toContain('workspace session')
    expect(prompt).toContain("not the workspace's manager")
  })

  it('agent-colleague keeps the continuing-colleague framing and its placeholder', () => {
    const prompt = loadSessionInstruction('agent-colleague')
    expect(prompt).toContain('{{agentName}}')
    expect(prompt).toContain('persistent colleague')
    expect(prompt).toContain('This conversation is your memory')
  })

  // test: correct expectation — `voice-turn.md` (the modifier) became
  // `voice-base.md` (the voice channel's base): same spoken-format directives
  // (voice-realtime VR1/VR3), plus the shared ground rules phrased for the ear.
  it('voice-base teaches the spoken style and says the speak tool is gone', () => {
    const prompt = loadSessionInstruction('voice-base')
    expect(prompt).toContain('VOICE')
    expect(prompt).toContain('HEARD as you write')
    expect(prompt).toContain('ONE or TWO short spoken sentences')
    expect(prompt).toContain('Lead with the answer')
    expect(prompt).toContain('No markdown')
    // The thread is long-lived and its transcript is full of the model's older
    // `speak` calls — the prompt must say the tool is gone, or a resumed turn
    // calls it and takes a disallowed-tool error mid-answer.
    expect(prompt).toContain('There is no `speak` tool')
    // ...and it must never read as an instruction to call it.
    expect(prompt).not.toMatch(/call(ing)? `?speak/i)
    // No canned acknowledgment lines anywhere (VR3) — the prompt names the
    // banned fillers so the model's own first sentence is the acknowledgment.
    expect(prompt).toContain('let me check')
    expect(prompt).toContain('one moment')
  })

  // The two bases are DELIBERATELY parallel files (text vs ear) — this pins the
  // core disciplines to BOTH so an edit to one cannot silently drop a rule the
  // other still states.
  it('the two bases stay aligned on the core disciplines', () => {
    for (const id of ['base', 'voice-base'] as const) {
      const prompt = loadSessionInstruction(id)
      expect(prompt, id).toContain('approval card')
      expect(prompt, id).toContain('real schedule')
      expect(prompt, id).toContain('You are Claude')
      expect(prompt, id).toContain('read_playbook')
    }
  })

  it('autopilot-marker tells the model it is on autopilot and names the needs_input exit', () => {
    const body = loadSessionInstruction('autopilot-marker')
    expect(body).toContain('AUTOPILOT')
    expect(body).toContain('needs_input')
  })

  it('voice-turn-marker re-states the spoken style (and the missing tool) in one line', () => {
    const marker = loadSessionInstruction('voice-turn-marker')
    expect(marker).toContain('VOICE')
    expect(marker).toContain('HEARD as you write')
    expect(marker).toContain('There is no `speak` tool')
    expect(marker).not.toMatch(/call(ing)? `?speak/i)
    expect(marker.trim().split('\n')).toHaveLength(1)
  })

  it('fails loudly for an id with no backing markdown file', () => {
    expect(() =>
      loadSessionInstruction('does-not-exist' as SessionInstructionId),
    ).toThrow(/could not be read/)
  })
})