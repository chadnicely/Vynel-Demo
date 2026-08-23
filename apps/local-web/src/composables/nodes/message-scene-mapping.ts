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
 *  `nodeIdBySegmentId` therefore carries the whole chain of every dot drawn.
 *
 *  The room's own thread is deliberately NOT in the map (Kafi, 2026-08-24 —
 *  the primary IS the centre): an unmapped endpoint resolves to null, which
 *  the scene anchors at the core, so the build's traffic arrives exactly
 *  where the build now lives. The both-null rule keeps the primary's own
 *  segment-to-segment chatter off the stage. */
export function projectMessages(
  edges: readonly MessageEdgeLike[],
  input: {
    /** Every segment of every drawn conversation → the node that draws it. */
    nodeIdBySegmentId: ReadonlyMap<string, string>;
  },
): SceneMessage[] {
  const bySession = (sessionId: string | null): string | null =>
    sessionId === null ? null : (input.nodeIdBySegmentId.get(sessionId) ?? null);
  return edges
    .map((edge) =>
      keep(edge, bySession(edge.fromSessionId), bySession(edge.toSessionId)),
    )
    .filter((message): message is SceneMessage => message !== null);
}
