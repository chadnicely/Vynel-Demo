/** "just now" · "12m ago" · "3h ago" · "2d ago" — sidebar-row scale. */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
): string {
  const elapsedMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
