import type { Ref } from "vue";
import type {
  SceneMessage,
  SceneNode,
} from "../../utils/constellation-scene.js";
import type {
  SceneNodeKind,
  SceneNodeRef,
} from "../../utils/constellation-node-ref.js";

// The node screen is a STACK of levels, not a boolean.
//
// It used to be one `drilledProjectId` ref with `isInsideProject` branching
// through six computeds and a hard-coded two-level `onNodeClick`; a third
// level meant editing all of them and inventing a third id vocabulary
// (2026-08-19 audit — every one of the five agents named this as the reason
// the screen could not grow).
//
// Now: one composable per level produces a `NodeLevel`, the registry says
// which level a drilled-into KIND opens, and the view renders whichever level
// the stack points at. Adding "a session's spawned children, agent runs and
// tasks" is one `useSessionNodes()` composable plus one registry entry.
//
// The contract each level composable must honour:
//   - it is called ONCE, at setup, like every other composable — the registry
//     is built there, so a level cannot be constructed lazily inside a
//     computed. A level that is not on show idles instead: its queries take
//     an `enabled` off its own ref being null (the shipped `useProjectNodes`
//     pattern), so an off-screen level costs no requests;
//   - `nodes` mint their ids through `constellation-node-ref.ts`;
//   - `hasAnswered` is false until every read behind `nodes` has answered, so
//     "nothing here" is never claimed from data we do not have yet.

export interface NodeLevel {
  nodes: Readonly<Ref<readonly SceneNode[]>>;
  /** The arcs this level can draw — each level matches the same wire edges
   *  against its own nodes. */
  messages: Readonly<Ref<readonly SceneMessage[]>>;
  /** What the centre orb wears while this level is on show. */
  coreLabel: Readonly<Ref<string>>;
  /** The centre IS this level's primary conversation (the global root out on
   *  the fleet, the room's own thread inside one — Kafi 2026-08-24), so it
   *  carries that conversation's status into the scene's palette. */
  coreStatus: Readonly<Ref<SceneNode["status"]>>;
  hasAnswered: Readonly<Ref<boolean>>;
  /** What clicking one of this level's dots MEANS — descend, or open it. */
  onPick: (ref: SceneNodeRef, label: string) => void;
  /** What clicking the CENTRE means — opening the primary it stands for. */
  onCorePick: () => void;
}

/** Where the user is standing: the refs drilled into, outermost first. Empty
 *  is the fleet. `label` is the crumb — captured at the click, because the
 *  level that knew the name may no longer be mounted. */
export interface NodeLevelStackEntry {
  ref: SceneNodeRef;
  label: string;
}

/** `root` is the level with nothing drilled into; every other key is the KIND
 *  of node you clicked to get there. A kind with no entry cannot be entered. */
export type NodeLevelRegistry = Partial<Record<SceneNodeKind, NodeLevel>> & {
  root: NodeLevel;
};

/** Whether a dot of this kind opens a level of its own, or does something
 *  else (the project level's session dots open the chat). */
export function hasLevelFor(
  kind: SceneNodeKind,
  registry: NodeLevelRegistry,
): boolean {
  return registry[kind] !== undefined;
}

/** The level the stack points at. Falls back to the root rather than throwing
 *  — a stack entry whose kind has no level is a bug in the pusher, and an
 *  empty screen would hide it worse than the fleet does. */
export function activeNodeLevel(
  stack: readonly NodeLevelStackEntry[],
  registry: NodeLevelRegistry,
): NodeLevel {
  const top = stack[stack.length - 1];
  if (top === undefined) return registry.root;
  return registry[top.ref.kind] ?? registry.root;
}
