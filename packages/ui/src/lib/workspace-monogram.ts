// A workspace's two-letter mark — the sibling of workspace-color.ts: the same
// stable, derived-not-stored identity, as text. "vynel" → "VY"; a multi-word
// name takes its words' initials ("Marketing site" → "MS").

export function workspaceMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const monogram =
    words.length >= 2
      ? `${words[0]![0]}${words[1]![0]}`
      : words[0]!.slice(0, 2);
  return monogram.toUpperCase();
}
