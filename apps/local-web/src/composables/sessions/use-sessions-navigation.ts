import { computed } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import type {
  SessionsOverviewEntry,
  SessionsOverviewSegment,
} from "@vynel/contracts/chat/sessions-overview";
import { useUiStore } from "../../stores/ui-store.js";

// The Sessions surface's navigation, in ONE home (Kafi, 2026-08-24: the
// library moved into the sidebar — the way a room's menus do — and the middle
// list column is gone). The scope AND the open conversation ride the route:
//
//   /sessions?workspace=<id>      the room's library (bare = the root's own children)
//   &session=<entrySessionId>     the conversation open in the pane, followed at its head
//   &part=<segmentSessionId>      an earlier, superseded part of it — view-only
//
// so the sidebar (which lists) and the view (which renders) agree without
// sharing a store, and a reload lands where you were.
export function useSessionsNavigation() {
  const route = useRoute();
  const router = useRouter();
  const ui = useUiStore();

  const workspaceScopeId = computed(() => queryString(route.query.workspace));
  const openSessionId = computed(() => queryString(route.query.session));
  const openPartId = computed(() => queryString(route.query.part));

  function scopeQuery(): LocationQueryRaw {
    return workspaceScopeId.value === null
      ? {}
      : { workspace: workspaceScopeId.value };
  }

  /** Open a conversation at its head. A ROOM's own conversation lives in its
   *  Chat, not here — its row routes to the room (locked decision 2). */
  function openEntry(entry: SessionsOverviewEntry) {
    if (entry.scope === "workspace") {
      if (entry.workspaceId !== null) ui.openWorkspaceTab(entry.workspaceId);
      void router.push({ name: "workspace" });
      return;
    }
    void router.push({
      name: "sessions",
      query: { ...scopeQuery(), session: entry.sessionId },
    });
  }

  /** Open one part of a continued conversation: the head is the entry's own
   *  open; a superseded part opens view-only and stays put (the user asked
   *  for THIS part — never re-resolved to the head). */
  function openSegment(
    entry: SessionsOverviewEntry,
    segment: SessionsOverviewSegment,
  ) {
    if (segment.sessionId === entry.sessionId) {
      openEntry(entry);
      return;
    }
    void router.push({
      name: "sessions",
      query: {
        ...scopeQuery(),
        session: entry.sessionId,
        part: segment.sessionId,
      },
    });
  }

  /** The back row: return to the scope's own MENUS — the room's, or the
   *  global one. The tree yields (a cold load leaves it open), so the row
   *  lands on the menus it names, never on the workspace tree. */
  function leaveSessions() {
    ui.isWorkspaceTreeOpen = false;
    void router.push({
      name: workspaceScopeId.value === null ? "chat" : "workspace",
    });
  }

  return {
    workspaceScopeId,
    openSessionId,
    openPartId,
    openEntry,
    openSegment,
    leaveSessions,
  };
}

function queryString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
