import { describe, expect, it } from 'vitest'
import {
  parseComposerTokens,
  replaceMentions,
  formatAgentMentionToken,
  formatPersonaMentionToken,
  formatWorkspaceRefToken,
  formatSlashCommandToken,
} from './composer-tokens.js'

describe('parseComposerTokens — mentions', () => {
  it('parses a kebab agent slug with exact offsets', () => {
    const text = 'hey @code-reviewer check this'
    const { mentions } = parseComposerTokens(text)
    expect(mentions).toEqual([{ name: 'code-reviewer', start: 4, end: 18 }])
    expect(text.slice(4, 18)).toBe('@code-reviewer')
  })

  it('parses a Capitalized persona name', () => {
    const { mentions } = parseComposerTokens('@Sarah please review')
    expect(mentions).toEqual([{ name: 'Sarah', start: 0, end: 6 }])
  })

  it('parses multiple mentions in order, keeping every occurrence', () => {
    const { mentions } = parseComposerTokens('@a then @b then @a')
    expect(mentions.map((m) => m.name)).toEqual(['a', 'b', 'a'])
  })

  it('a mention after a newline counts (whitespace boundary)', () => {
    const { mentions } = parseComposerTokens('line one\n@helper go')
    expect(mentions).toEqual([{ name: 'helper', start: 9, end: 16 }])
  })

  it('never matches inside an email address or a word', () => {
    const { mentions } = parseComposerTokens('mail chad@acme.com or foo@bar')
    expect(mentions).toEqual([])
  })

  it('a bare @ or @@ is plain text', () => {
    expect(parseComposerTokens('an @ sign').mentions).toEqual([])
    expect(parseComposerTokens('@@double').mentions).toEqual([])
  })

  it('stops at the first character outside the token charset', () => {
    const { mentions } = parseComposerTokens('@sarah, hello')
    expect(mentions).toEqual([{ name: 'sarah', start: 0, end: 6 }])
  })

  it('does not swallow a trailing hyphen', () => {
    const { mentions } = parseComposerTokens('@fix- it')
    expect(mentions).toEqual([{ name: 'fix', start: 0, end: 4 }])
  })
})

describe('parseComposerTokens — workspace refs', () => {
  it('parses a simple ref with offsets', () => {
    const text = 'study #vynel today'
    const { workspaceRefs } = parseComposerTokens(text)
    expect(workspaceRefs).toEqual([{ name: 'vynel', quoted: false, start: 6, end: 12 }])
    expect(text.slice(6, 12)).toBe('#vynel')
  })

  it('parses the quoted form, quotes excluded from the name', () => {
    const text = 'look at #"Q3 plans" please'
    const { workspaceRefs } = parseComposerTokens(text)
    expect(workspaceRefs).toEqual([{ name: 'Q3 plans', quoted: true, start: 8, end: 19 }])
    expect(text.slice(8, 19)).toBe('#"Q3 plans"')
  })

  it('supports dots, underscores, and dashes in the simple form', () => {
    const { workspaceRefs } = parseComposerTokens('#my-app_v2.1')
    expect(workspaceRefs[0]?.name).toBe('my-app_v2.1')
  })

  it('a markdown heading (# followed by a space) is not a ref', () => {
    expect(parseComposerTokens('# Heading').workspaceRefs).toEqual([])
  })

  it('issue#42 mid-word is not a ref (word boundary)', () => {
    expect(parseComposerTokens('see issue#42').workspaceRefs).toEqual([])
  })

  it('an unclosed quote is plain text', () => {
    expect(parseComposerTokens('#"unclosed name').workspaceRefs).toEqual([])
  })

  it('a quoted name never spans a newline', () => {
    expect(parseComposerTokens('#"one\ntwo"').workspaceRefs).toEqual([])
  })

  it('parses several refs, mixed forms', () => {
    const { workspaceRefs } = parseComposerTokens('#alpha and #"beta two"')
    expect(workspaceRefs.map((ref) => ref.name)).toEqual(['alpha', 'beta two'])
  })
})

describe('parseComposerTokens — slash command', () => {
  it('parses a command at the start with offsets', () => {
    const { slashCommand } = parseComposerTokens('/deploy the site')
    expect(slashCommand).toEqual({ command: 'deploy', start: 0, end: 7 })
  })

  it('tolerates leading whitespace', () => {
    const { slashCommand } = parseComposerTokens('  /status')
    expect(slashCommand).toEqual({ command: 'status', start: 2, end: 9 })
  })

  it('parses a namespaced command', () => {
    const { slashCommand } = parseComposerTokens('/git:commit now')
    expect(slashCommand).toEqual({ command: 'git:commit', start: 0, end: 11 })
  })

  it('mid-message slashes are not commands (Claude Code semantics)', () => {
    expect(parseComposerTokens('run /deploy later').slashCommand).toBeNull()
    expect(parseComposerTokens('a/b paths').slashCommand).toBeNull()
  })

  it('a bare slash or a path is not a command', () => {
    expect(parseComposerTokens('/').slashCommand).toBeNull()
    expect(parseComposerTokens('/ x').slashCommand).toBeNull()
  })

  it('arguments after the command are not part of the token', () => {
    const text = '/review src/index.ts'
    const { slashCommand } = parseComposerTokens(text)
    expect(text.slice(slashCommand!.start, slashCommand!.end)).toBe('/review')
  })
})

describe('parseComposerTokens — combined', () => {
  it('one message can carry all three token kinds', () => {
    const { mentions, workspaceRefs, slashCommand } = parseComposerTokens(
      '/plan with @Sarah and @code-reviewer using #"my app"',
    )
    expect(slashCommand?.command).toBe('plan')
    expect(mentions.map((m) => m.name)).toEqual(['Sarah', 'code-reviewer'])
    expect(workspaceRefs.map((ref) => ref.name)).toEqual(['my app'])
  })

  it('empty and token-free text parses to empty results', () => {
    expect(parseComposerTokens('')).toEqual({
      mentions: [],
      workspaceRefs: [],
      slashCommand: null,
    })
    expect(parseComposerTokens('plain words only')).toEqual({
      mentions: [],
      workspaceRefs: [],
      slashCommand: null,
    })
  })
})

describe('format helpers round-trip through the parser', () => {
  it('agent and persona mention tokens', () => {
    for (const token of [formatAgentMentionToken('code-reviewer'), formatPersonaMentionToken('Sarah')]) {
      const { mentions } = parseComposerTokens(token)
      expect(mentions).toHaveLength(1)
      expect(`@${mentions[0]!.name}`).toBe(token)
    }
  })

  it('workspace tokens — simple stays bare, spaced auto-quotes, unicode auto-quotes', () => {
    expect(formatWorkspaceRefToken('vynel')).toBe('#vynel')
    expect(formatWorkspaceRefToken('Q3 plans')).toBe('#"Q3 plans"')
    expect(formatWorkspaceRefToken('métier')).toBe('#"métier"')
    for (const name of ['vynel', 'Q3 plans', 'métier']) {
      const { workspaceRefs } = parseComposerTokens(formatWorkspaceRefToken(name))
      expect(workspaceRefs[0]?.name).toBe(name)
    }
  })

  it('a name with embedded double quotes drops them when quoted', () => {
    const token = formatWorkspaceRefToken('my "cool" app')
    expect(token).toBe('#"my cool app"')
    expect(parseComposerTokens(token).workspaceRefs[0]?.name).toBe('my cool app')
  })

  it('slash command tokens', () => {
    const token = formatSlashCommandToken('git:commit')
    expect(parseComposerTokens(token).slashCommand?.command).toBe('git:commit')
  })

  // The renderer paints chips through this, so it must agree with the parser
  // above — a mention shown is a mention resolved.
  describe('replaceMentions', () => {
    const wrap = (text: string) => replaceMentions(text, (name) => `[${name}]`)

    it('rewrites what the parser calls a mention', () => {
      expect(wrap('ask @Sarah and @code-reviewer')).toBe('ask [Sarah] and [code-reviewer]')
    })

    it('leaves an address alone, exactly as the parser does', () => {
      expect(parseComposerTokens('mail chad@acme.com').mentions).toHaveLength(0)
      expect(wrap('mail chad@acme.com')).toBe('mail chad@acme.com')
    })

    it('returns text with no mention untouched', () => {
      expect(wrap('nothing to see')).toBe('nothing to see')
    })
  })
})
