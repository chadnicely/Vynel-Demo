// The node screen's ONE identity vocabulary.
//
// A dot's id used to be a per-level string convention — a bare workspace id
// out on the fleet, `continuing:<workspaceId>` / `session:<sessionId>` inside
// a project — minted in two composables and parsed back with `startsWith` +
// `slice` in two more. Every new level meant another prefix and another
// parser, which is the concrete reason the screen was stuck at two levels
// (2026-08-19 audit, A5-08 / agent-3 §5a.2).
//
// Every level now mints its ids here and every reader parses them here, so a
// level's nodes can be drawn, clicked and matched against a message endpoint
// without anyone knowing which level produced them.

/** What one dot IS.
 *
 *  `voice` is a CHILD of global (Kafi, 2026-08-19, D7): it has a ref so the
 *  data path exists end to end, and no level draws one yet — the layout that
 *  gives global and voice their place is Kafi's later visual pass. */
export const SCENE_NODE_KINDS = [
  "workspace",
  "global",
  "voice",
  "session",
  "agent-run",
  "task",
] as const;

export type SceneNodeKind = (typeof SCENE_NODE_KINDS)[number];

export interface SceneNodeRef {
  kind: SceneNodeKind;
  /** The domain id — a workspace id, a conversation's session id, a job id.
   *  Opaque here: only the level that minted it knows how to open it. */
  id: string;
}

const KIND_BY_NAME = new Set<string>(SCENE_NODE_KINDS);

/** The scene addresses nodes by string (it draws pixels, not domain objects),
 *  so a ref folds to `<kind>:<id>`. Ids carry their own colons on some wire
 *  shapes, which is why only the FIRST separator is structural. */
export function sceneNodeId(ref: SceneNodeRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** The inverse. `null` for anything this screen did not mint — a caller that
 *  gets one has read an id from outside the vocabulary and should ignore it
 *  rather than guess a kind. */
export function parseSceneNodeId(nodeId: string): SceneNodeRef | null {
  const separator = nodeId.indexOf(":");
  if (separator <= 0) return null;
  const kind = nodeId.slice(0, separator);
  const id = nodeId.slice(separator + 1);
  if (!KIND_BY_NAME.has(kind) || id === "") return null;
  return { kind: kind as SceneNodeKind, id };
}

/** Same ref, same node — used where a level has to recognise its own dots. */
export function isSceneNodeRefEqual(a: SceneNodeRef, b: SceneNodeRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}
