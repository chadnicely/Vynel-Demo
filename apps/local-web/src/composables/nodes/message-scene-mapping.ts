import type { SceneMessage } from "../../utils/constellation-scene.js";
import { sceneNodeId } from "../../utils/constellation-node-ref.js";

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

/** The fleet's arcs — workspace to workspace. An endpoint is drawable exactly
 *  when that room is one of the dots on screen. */
export function fleetMessages(
  edges: readonly MessageEdgeLike[],
  drawnNodeIds: ReadonlySet<string>,
): SceneMessage[] {
  const anchor = (workspaceId: string | null) => {
    if (workspaceId === null) return null;
    const nodeId = sceneNodeId({ kind: "workspace", id: workspaceId });
    return drawnNodeIds.has(nodeId) ? nodeId : null;
  };
  return edges
    .map((edge) => keep(edge, anchor(edge.fromWorkspaceId), anchor(edge.toWorkspaceId)))
    .filter((message): message is SceneMessage => message !== null);
}

/** One project's arcs — conversation to conversation.
 *
 *  Endpoints arrive as SEGMENT ids, and a conversation is a CHAIN of them: it
 *  used to match only each conversation's current head, so after a context
 *  swap every arc touching a pre-swap segment silently vanished from a screen
 *  whose whole job is showing what just happened (2026-08-19 audit, A5-10).
 *  `nodeIdBySegmentId` therefore carries the whole chain of every dot drawn. */
export function projectMessages(
  edges: readonly MessageEdgeLike[],
  input: {
    projectId: string;
    /** Every segment of every drawn conversation → the node that draws it. */
    nodeIdBySegmentId: ReadonlyMap<string, string>;
  },
): SceneMessage[] {
  const buildNodeId = sceneNodeId({ kind: "workspace", id: input.projectId });
  const bySession = (sessionId: string | null): string | null =>
    sessionId === null ? null : (input.nodeIdBySegmentId.get(sessionId) ?? null);
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
