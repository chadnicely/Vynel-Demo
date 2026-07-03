// OS detection — picks the notification backend (and, later, the accessibility
// engine's native binary). `process.platform` is a runtime fact, not env
// config, so it stays out of `env.ts`.

export type DesktopOs = 'windows' | 'macos' | 'linux'

export function resolveDesktopOs(): DesktopOs {
  switch (process.platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'macos'
    default:
      return 'linux'
  }
}
