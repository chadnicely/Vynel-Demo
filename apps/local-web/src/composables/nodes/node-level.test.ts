// The level stack — and the promise it makes: a THIRD level is one new
// composable plus one registry entry, not an edit to six computeds in the
// view. The fake level below is what that composable would return.

import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import {
  activeNodeLevel,
  hasLevelFor,
  type NodeLevel,
  type NodeLevelRegistry,
  type NodeLevelStackEntry,
} from "./node-level.js";

function makeLevel(coreLabel: string, onPick = vi.fn()): NodeLevel {
  return {
    nodes: computed(() => [
      { id: `session:${coreLabel}`, name: coreLabel, initials: "XX", status: "idle" as const },
    ]),
    messages: computed(() => []),
    coreLabel: computed(() => coreLabel),
    coreStatus: computed(() => "idle" as const),
    hasAnswered: computed(() => true),
    onPick,
    onCorePick: vi.fn(),
  };
}

const fleet = makeLevel("Vynel");
const project = makeLevel("Evernote");
const registry: NodeLevelRegistry = { root: fleet, workspace: project };

describe("activeNodeLevel", () => {
  it("an empty stack is the root level", () => {
    expect(activeNodeLevel([], registry)).toBe(fleet);
  });

  it("the top of the stack decides, by the KIND that was drilled into", () => {
    const stack: NodeLevelStackEntry[] = [
      { ref: { kind: "workspace", id: "ws-1" }, label: "Evernote" },
    ];
    expect(activeNodeLevel(stack, registry)).toBe(project);
  });

  it("a kind with no level falls back to the root rather than a blank stage", () => {
    const stack: NodeLevelStackEntry[] = [
      { ref: { kind: "task", id: "job-9" }, label: "July invoicing" },
    ];
    expect(activeNodeLevel(stack, registry)).toBe(fleet);
  });
});

describe("hasLevelFor", () => {
  it("says which dots can be descended into", () => {
    expect(hasLevelFor("workspace", registry)).toBe(true);
    expect(hasLevelFor("session", registry)).toBe(false);
  });
});

describe("adding a third level", () => {
  // Everything a `useSessionNodes()` composable would hand back: its own
  // dots, its own arcs, its own core label, its own meaning for a click.
  const sessionLevel = makeLevel("Research: pricing");
  const deeper: NodeLevelRegistry = { ...registry, session: sessionLevel };

  it("costs one registry entry — nothing else in the screen changes", () => {
    expect(hasLevelFor("session", deeper)).toBe(true);
    const stack: NodeLevelStackEntry[] = [
      { ref: { kind: "workspace", id: "ws-1" }, label: "Evernote" },
      { ref: { kind: "session", id: "sdk-7" }, label: "Research: pricing" },
    ];
    const level = activeNodeLevel(stack, deeper);
    expect(level).toBe(sessionLevel);
    expect(level.coreLabel.value).toBe("Research: pricing");
    expect(level.nodes.value).toHaveLength(1);
  });

  it("stepping back up shows the level below it again", () => {
    const stack = ref<NodeLevelStackEntry[]>([
      { ref: { kind: "workspace", id: "ws-1" }, label: "Evernote" },
      { ref: { kind: "session", id: "sdk-7" }, label: "Research: pricing" },
    ]);
    stack.value = stack.value.slice(0, -1);
    expect(activeNodeLevel(stack.value, deeper)).toBe(project);
    stack.value = stack.value.slice(0, -1);
    expect(activeNodeLevel(stack.value, deeper)).toBe(fleet);
  });
});
