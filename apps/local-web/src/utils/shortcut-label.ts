// Platform-true shortcut hints: Windows/Linux users see "Ctrl+Shift+N", Mac
// users "⌘⇧N". The bindings accept either modifier (metaKey || ctrlKey) —
// only the LABEL is per-platform, because a hint wearing the wrong modifier
// reads as broken to the very users Vynel is for.
const isMacPlatform =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

export function shortcutHint(
  key: string,
  options: { shift?: boolean } = {},
  isMac: boolean = isMacPlatform,
): string {
  if (isMac) return `⌘${options.shift ? "⇧" : ""}${key}`;
  return `Ctrl+${options.shift ? "Shift+" : ""}${key}`;
}
