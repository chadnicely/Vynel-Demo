import { describe, it, expect } from 'vitest'
import { selectWindowedPid, type WindowedProcess } from './windowed-process.js'

const processes: WindowedProcess[] = [
  { pid: 100, processName: 'chrome', windowTitle: 'Fast.com - Google Chrome' },
  { pid: 9624, processName: 'Discord', windowTitle: '@user - Discord' },
  { pid: 288, processName: 'TelegramDesktop', windowTitle: 'Telegram' },
  { pid: 10, processName: 'explorer', windowTitle: 'vynel - File Explorer' },
]

describe('selectWindowedPid', () => {
  it('matches by process name (the Electron case: Discord open but not UIA-enumerated)', () => {
    expect(selectWindowedPid(processes, 'Discord')).toBe(9624)
  })

  it('matches case-insensitively', () => {
    expect(selectWindowedPid(processes, 'discord')).toBe(9624)
    expect(selectWindowedPid(processes, 'DISCORD')).toBe(9624)
  })

  it('matches a substring of the window title when the process name differs', () => {
    // Telegram's process is "TelegramDesktop"; "Telegram" still resolves via title.
    expect(selectWindowedPid(processes, 'Telegram')).toBe(288)
    // A title-only fragment.
    expect(selectWindowedPid(processes, 'File Explorer')).toBe(10)
  })

  it('returns null when nothing matches', () => {
    expect(selectWindowedPid(processes, 'Notepad')).toBeNull()
  })

  it('returns null for a blank query (never resolves an arbitrary window)', () => {
    expect(selectWindowedPid(processes, '')).toBeNull()
    expect(selectWindowedPid(processes, '   ')).toBeNull()
  })

  it('returns the first match when several windows match', () => {
    const chatMatches: WindowedProcess[] = [
      { pid: 1, processName: 'Code', windowTitle: 'a.ts - chat - Visual Studio Code' },
      { pid: 2, processName: 'chat-app', windowTitle: 'Chat' },
    ]
    expect(selectWindowedPid(chatMatches, 'chat')).toBe(1)
  })
})
