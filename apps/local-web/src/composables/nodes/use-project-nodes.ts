import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { SessionsOverviewEntry } from "@vynel/contracts/chat/sessions-overview";
import { useSessionStatuses } from "../sessions/use-session-statuses.js";
import { useWorkspaceStatuses } from "../workspaces/use-workspace-status.js";
import { sessionKeys, sessionScopeKey } from "../chat/session-keys.js";
import { useVynel } from "../use-vynel.js";
import { initialsOf } from "../../utils/constellation-layout.js";
import type { SceneNode } from "../../utils/constellation-scene.js";
import {
  sceneNodeId,
  type SceneNodeRef,
} from "../../utils/constellation-node-ref.js";
import { resolveNodeStatus } from "./node-status.js";
import { projectMessages, type MessageEdgeLike } from "./message-scene-mapping.js";
import type { NodeLevel } from "./node-level.js";

// The SECOND level of the node screen (Chad, 2026-08-11): step inside one
// project and the dots become its own conversations — the continuing build
// first, then every session it holds. Both readings come from main's real
// ladders (Move 3): each session's own derived status, and — for the build —
// the ROOM's status, since the continuing thread is what the room's status
// already describes (one truth, tree and node screen alike).
export function useProjectNodes(input: {
  workspaceId: MaybeRefOrGetter<string | null>;
  workspaceName: MaybeRefOrGetter<string | null>;
  edges: MaybeRefOrGetter<readonly MessageEdgeLike[]>;
  onPick: (ref: SceneNodeRef, label: string) => void;
}): NodeLevel {
  const vynel = useVynel();
  const workspaceStatuses = useWorkspaceStatuses();
  const id = computed(() => toValue(input.workspaceId));

  // SCOPED server-side, not filtered here. This used to read the app-wide,
  // 50-capped, unscoped overview and drop the other rooms' rows locally —
  // so once the user had 50 newer conversations anywhere, a drilled project
  // showed a SUBSET of its own sessions with no indication (2026-08-19
  // audit, A5-07 / B8). `use-sessions-library.ts` records the same lesson:
  // curate before the cap or the page arrives empty.
  const sessionsQuery = useQuery({
    queryKey: computed(() => [
      ...sessionKeys.all,
      "overview",
      sessionScopeKey({
        kind: "workspace" as const,
        workspaceId: id.value ?? "none",
      }),
    ]),
    queryFn: () =>
      vynel.sessions.overview({
        scope: "workspace" as const,
        workspaceId: id.value!,
      }) as Promise<SessionsOverviewEntry[]>,
    enabled: computed(() => id.value !== null),
  });

  // The project's continuing build is hidden from the overview end to end, so
  // it is asked for by name — read-only, nulls until the room's first turn.
  const continuingQuery = useQuery({
    queryKey: computed(() => [
      ...sessionKeys.all,
      "continuing",
      sessionScopeKey({
        kind: "workspace" as const,
        workspaceId: id.value ?? "none",
      }),
    ]),
    queryFn: () => vynel.chat.getContinuing(id.value!),
    enabled: computed(() => id.value !== null),
    staleTime: 15_000,
  });

  const entries = computed<readonly SessionsOverviewEntry[]>(
    () => sessionsQuery.data.value ?? [],
  );

  // Statuses derive from OUR entries, not the shared read. The scoped list
  // above can hold rows the app-wide capped page never saw, and those rows
  // would otherwise have no status row at all and paint a confident grey.
  // Still ONE ladder: `useSessionStatuses` runs `deriveSessionStatus` over
  // whichever entries it is handed (the Sessions library's paging precedent).
  const sessionStatuses = useSessionStatuses(entries);

  const nodes = computed<SceneNode[]>(() => {
    const workspaceId = id.value;
    if (workspaceId === null) return [];
    const rows: SceneNode[] = [];
    const continuing = continuingQuery.data.value;
    if ((continuing?.rootSessionId ?? null) !== null) {
      // The build IS the room's ongoing conversation, so it wears the room's
      // status — the same one the tree row shows (it reaches `problem` from a
      // failed turn, `needs_input` from an approval or the assistant's own
      // set state) — and it is addressed by the room's own ref, which is the
      // one identity that survives a context swap (the head segment id does
      // not, and re-keying the dot mid-conversation would fly it in again).
      //
      // KNOWN OVER-CLAIM (inherited from the workspace ladder, and the reason
      // this note is worth keeping): an AGENT colleague's turn announces under
      // its grounding workspace, so a failing colleague can light this dot as
      // well as its own. The build chain is hidden from the overview, so it
      // has no per-conversation facts of its own to read instead; splitting
      // them is the fix if the double-dot ever bites.
      const view = workspaceStatuses.statusByWorkspaceId.value[workspaceId];
      rows.push({
        id: sceneNodeId({ kind: "workspace", id: workspaceId }),
        name: "The build",
        initials: "BD",
        status: resolveNodeStatus(view?.status ?? "not_running"),
        ...(view === undefined
          ? {}
          : {
              detail: {
                note: view.note,
                tasksDone: view.tasksDone,
                tasksTotal: view.tasksTotal,
              },
            }),
      });
    }
    for (const entry of entries.value) {
      const view = sessionStatuses.statusFor(entry.sessionId);
      rows.push({
        id: sceneNodeId({ kind: "session", id: entry.sessionId }),
        name: entry.title,
        initials: initialsOf(entry.title),
        status: resolveNodeStatus(view?.status ?? "idle"),
        ...(view === null ? {} : { detail: { note: view.note } }),
      });
    }
    return rows;
  });

  /** Both reads have answered — only then is "nothing here" the truth rather
   *  than the loading state. */
  const hasAnswered = computed(
    () =>
      sessionsQuery.data.value !== undefined &&
      continuingQuery.data.value !== undefined,
  );

  /** Every segment of every drawn conversation, pointing at the dot that
   *  draws it — how an arc finds its endpoint across a context swap.
   *
   *  The build contributes only the segment it is CURRENTLY on: its chain is
   *  hidden from the overview (`fold-session-chains.ts`) and `chat.getContinuing`
   *  answers with the head alone, so its pre-swap segments are unreachable
   *  from here. Recorded as a §6 ask on the continuing payload. */
  const nodeIdBySegmentId = computed(() => {
    const byId = new Map<string, string>();
    const workspaceId = id.value;
    const head = continuingQuery.data.value?.currentSdkSessionId ?? null;
    if (workspaceId !== null && head !== null) {
      byId.set(head, sceneNodeId({ kind: "workspace", id: workspaceId }));
    }
    for (const entry of entries.value) {
      const nodeId = sceneNodeId({ kind: "session", id: entry.sessionId });
      for (const segment of entry.segments) byId.set(segment.sessionId, nodeId);
    }
    return byId;
  });

  const messages = computed(() => {
    const workspaceId = id.value;
    if (workspaceId === null) return [];
    return projectMessages(toValue(input.edges), {
      projectId: workspaceId,
      nodeIdBySegmentId: nodeIdBySegmentId.value,
    });
  });

  const coreLabel = computed(() => toValue(input.workspaceName) ?? "Project");

  return { nodes, messages, coreLabel, hasAnswered, onPick: input.onPick };
}
