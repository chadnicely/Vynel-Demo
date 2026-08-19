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
  /** The domain id. ONE id space per kind, and for `session` that space is
   *  the CHAT-SESSION id the rest of the app treats as a conversation's
   *  handle — the overview entry's `sessionId`, and what every
   *  `/sessions/:sessionId/...` door takes, `children` included. Never a
   *  primary-session id: a ref that cannot open a door is not an identity.
   *
   *  Opaque otherwise: only the level that minted it knows what to do with
   *  it. */
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

/** What a dot of this KIND hangs under, when its kind alone decides.
 *
 *  Only `voice` does: it is a CHILD of global (Kafi, 2026-08-19, D7) — one
 *  assistant, two ways of reaching it — so whichever level draws the global
 *  assistant is the level that draws the voice thread beside it, and the
 *  shell's global light already aggregates the pair. No level draws either
 *  yet; this is the relation the visual pass builds on, recorded here so it
 *  is a fact rather than a comment.
 *
 *  Every other kind's parent is a property of the ROW — which room a session
 *  is grounded in, which conversation set a task going — and is answered by
 *  `GET /sessions/:id/children`, never by the kind. */
export function parentSceneNodeKind(kind: SceneNodeKind): SceneNodeKind | null {
  return kind === "voice" ? "global" : null;
}
