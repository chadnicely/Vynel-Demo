// Unit tests for `renderSkillMarkdownTemplate`. Pure function.
// Per coding.md §8 + blueprint §11.3.

import { describe, expect, it } from 'vitest'
import { renderSkillMarkdownTemplate } from './render-skill-markdown-template.js'

describe('renderSkillMarkdownTemplate', () => {
  it('replaces a known placeholder with the value', () => {
    const out = renderSkillMarkdownTemplate('Sign-off: {{settings.signOff}}', {
      signOff: 'Best,',
    })
    expect(out).toBe('Sign-off: Best,')
  })

  it('replaces multiple placeholders in one pass', () => {
    const out = renderSkillMarkdownTemplate(
      '{{settings.greeting}}, the tone is {{settings.tone}}.',
      { greeting: 'Hi', tone: 'warm' },
    )
    expect(out).toBe('Hi, the tone is warm.')
  })

  it('leaves unknown placeholders intact (D7 fail-visible behavior)', () => {
    const out = renderSkillMarkdownTemplate(
      'Known: {{settings.known}} / Typo: {{settings.deafultSignOff}}',
      { known: 'yes' },
    )
    expect(out).toBe('Known: yes / Typo: {{settings.deafultSignOff}}')
  })

  it('tolerates whitespace inside braces', () => {
    const out = renderSkillMarkdownTemplate(
      'A:{{ settings.foo }} B:{{settings.foo }} C:{{settings.foo}}',
      { foo: 'X' },
    )
    expect(out).toBe('A:X B:X C:X')
  })

  it('coerces non-string scalars via String()', () => {
    const out = renderSkillMarkdownTemplate(
      'Count: {{settings.count}} / Enabled: {{settings.enabled}}',
      { count: 42, enabled: true },
    )
    expect(out).toBe('Count: 42 / Enabled: true')
  })

  it('returns the input unchanged when there are no placeholders', () => {
    const out = renderSkillMarkdownTemplate('Plain markdown without any tags.', {})
    expect(out).toBe('Plain markdown without any tags.')
  })

  it('does NOT match malformed placeholders', () => {
    // Single braces, missing dot, missing closer, etc.
    const out = renderSkillMarkdownTemplate(
      '{settings.foo} {{foo}} {{settings.}} {{settings.foo} {{settings.bar',
      { foo: 'X', bar: 'Y' },
    )
    expect(out).toBe('{settings.foo} {{foo}} {{settings.}} {{settings.foo} {{settings.bar')
  })

  it('replaces the same placeholder multiple times', () => {
    const out = renderSkillMarkdownTemplate('{{settings.x}} and {{settings.x}} again', {
      x: 'echo',
    })
    expect(out).toBe('echo and echo again')
  })
})
