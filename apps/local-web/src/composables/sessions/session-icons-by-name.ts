import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { useSessionsOverview } from "./use-sessions-overview.js";

// A delivered row names its author by LABEL only (`sourceLabel` — the
// spawned session's display name), never by id. To wear the session's own
// curated icon in the author line (Kafi, 2026-08-26: "the session got an
// icon, show it as the logo"), the host resolves that name against the
// sessions overview — the same read the Sessions panel and the tasks box
// already share. Child conversations only (spawned + agent colleagues): a
// room's own manager thread wears the workspace's face, not a session icon.

/** Persona name → its curated icon name (null = it has none, monogram). */
export type SessionIconsByName = Record<string, string | null>;

/** The pure fold — exported for its colocated test. `workspaceId` scopes the
 *  children to one room; null = the global surface, which hears reports from
 *  EVERY room's children, so every child is admitted. A name shared by two
 *  children resolves to the one that spoke most recently. */
export function buildSessionIconsByName(
  entries: readonly SessionsOverviewEntry[],
  workspaceId: string | null,
): SessionIconsByName {
  const latestByName = new Map<string, SessionsOverviewEntry>();
  for (const entry of entries) {
    if (entry.scope !== "spawned" && entry.scope !== "agent") continue;
    if (workspaceId !== null && entry.workspaceId !== workspaceId) continue;
    const name = entry.title.trim();
    if (name === "") continue;
    const known = latestByName.get(name);
    if (known === undefined || known.lastMessageAt < entry.lastMessageAt) {
      latestByName.set(name, entry);
    }
  }
  const icons: SessionIconsByName = {};
  for (const [name, entry] of latestByName) icons[name] = entry.icon;
  return icons;
}

export function useSessionIconsByName(
  workspaceId: MaybeRefOrGetter<string | null>,
): ComputedRef<SessionIconsByName> {
  const overviewQuery = useSessionsOverview(true);
  return computed(() =>
    buildSessionIconsByName(overviewQuery.data.value ?? [], toValue(workspaceId)),
  );
}
