import type { SceneMessage } from "../../utils/constellation-scene.js";

/** Structural — we ask only for the fields we draw with, rather than coupling
 *  the mapping to the generated wire type. */
export interface MessageEdgeLike {
  jobId: string;
  direction: "ask" | "reply";
  fromSessionId: string;
  toSessionId: string | null;
  fromWorkspaceId: string | null;
  toWorkspaceId: string | null;
  at: string;
}

/** An endpoint the scene can draw, or null meaning the core. A message with
 *  BOTH ends off this level is dropped — a line from nowhere to nowhere. */
function keep(
  edge: MessageEdgeLike,
  from: string | null,
  to: string | null,
): SceneMessage | null {
  if (from === null && to === null) return null;
  if (from === to) return null;
  return {
    id: edge.jobId,
    fromId: from,
    toId: to,
    direction: edge.direction,
    sentAt: Date.parse(edge.at),
  };
}

/** The fleet's arcs — workspace to workspace. A node id IS the workspace id out
 *  here, so an endpoint is drawable exactly when that room is on screen. */
export function fleetMessages(
  edges: readonly MessageEdgeLike[],
  drawnWorkspaceIds: ReadonlySet<string>,
): SceneMessage[] {
  const anchor = (workspaceId: string | null) =>
    workspaceId !== null && drawnWorkspaceIds.has(workspaceId) ? workspaceId : null;
  return edges
    .map((edge) => keep(edge, anchor(edge.fromWorkspaceId), anchor(edge.toWorkspaceId)))
    .filter((message): message is SceneMessage => message !== null);
}

/** One project's arcs — conversation to conversation. Two id shapes meet here:
 *  a spawned session is its own dot, while the room's continuing build is
 *  "The build" — so a message addressed to the WORKSPACE rather than to a
 *  session is addressed to that node. */
export function projectMessages(
  edges: readonly MessageEdgeLike[],
  input: {
    projectId: string;
    /** The segment the continuing build is currently on — how "The build"
     *  recognises itself as a sender. */
    continuingSessionId: string | null;
    drawnSessionIds: ReadonlySet<string>;
  },
): SceneMessage[] {
  const buildNodeId = `continuing:${input.projectId}`;
  const bySession = (sessionId: string | null): string | null => {
    if (sessionId === null) return null;
    if (sessionId === input.continuingSessionId) return buildNodeId;
    return input.drawnSessionIds.has(sessionId) ? `session:${sessionId}` : null;
  };
  return edges
    .map((edge) => {
      // A delivery names no target session: it goes to the requester's primary
      // conversation, which on this screen is the build.
      const to =
        edge.toSessionId === null && edge.toWorkspaceId === input.projectId
          ? buildNodeId
          : bySession(edge.toSessionId);
      return keep(edge, bySession(edge.fromSessionId), to);
    })
    .filter((message): message is SceneMessage => message !== null);
}
