// The node screen's one identity vocabulary — mint, parse, round-trip.

import { describe, expect, it } from "vitest";
import {
  isSceneNodeRefEqual,
  parseSceneNodeId,
  sceneNodeId,
  SCENE_NODE_KINDS,
} from "./constellation-node-ref.js";

describe("sceneNodeId / parseSceneNodeId", () => {
  it("round-trips every kind the screen can draw", () => {
    for (const kind of SCENE_NODE_KINDS) {
      const ref = { kind, id: "abc-123" };
      expect(parseSceneNodeId(sceneNodeId(ref))).toEqual(ref);
    }
  });

  it("keeps an id that carries its own colons intact", () => {
    // Only the FIRST separator is structural — session ids on other wire
    // shapes are not guaranteed colon-free.
    const ref = { kind: "session" as const, id: "sdk:7:9" };
    expect(sceneNodeId(ref)).toBe("session:sdk:7:9");
    expect(parseSceneNodeId("session:sdk:7:9")).toEqual(ref);
  });

  it("refuses anything this screen did not mint", () => {
    // The old vocabulary: a bare workspace id out on the fleet, and the
    // `continuing:` prefix inside a project.
    expect(parseSceneNodeId("ws-1")).toBeNull();
    expect(parseSceneNodeId("continuing:ws-1")).toBeNull();
    expect(parseSceneNodeId("")).toBeNull();
    expect(parseSceneNodeId(":ws-1")).toBeNull();
    expect(parseSceneNodeId("session:")).toBeNull();
  });
});

describe("isSceneNodeRefEqual", () => {
  it("separates the same id under two kinds", () => {
    expect(
      isSceneNodeRefEqual({ kind: "session", id: "x" }, { kind: "task", id: "x" }),
    ).toBe(false);
    expect(
      isSceneNodeRefEqual({ kind: "session", id: "x" }, { kind: "session", id: "x" }),
    ).toBe(true);
  });
});
