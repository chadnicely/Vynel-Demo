// What the constellation is told to draw: the fleet minus archived rooms,
// with exactly the workspaces that have a turn in flight reading as alive.

import { describe, expect, it } from "vitest";
import { buildSceneNodes, initialsOf } from "./constellation-layout.js";

const room = (id: string, name: string, isArchived = false) => ({
  id,
  name,
  isArchived,
});

describe("initialsOf", () => {
  it("takes two initials from a multi-word name", () => {
    expect(initialsOf("Nicely Community")).toBe("NC");
  });

  it("falls back to the first two letters of a single word", () => {
    expect(initialsOf("Evernote")).toBe("E");
  });
});

describe("buildSceneNodes", () => {
  it("draws one node per unarchived workspace", () => {
    const nodes = buildSceneNodes(
      [room("a", "Evernote"), room("b", "Letterman"), room("c", "Old", true)],
      () => "idle",
    );
    expect(nodes.map((node) => node.name)).toEqual(["Evernote", "Letterman"]);
  });

  it("gives each node the status the resolver reports", () => {
    const nodes = buildSceneNodes(
      [room("a", "Evernote"), room("b", "Letterman"), room("c", "Nicely")],
      (id) => (id === "b" ? "building" : id === "c" ? "waiting" : "idle"),
    );
    expect(nodes.map((node) => node.status)).toEqual([
      "idle",
      "building",
      "waiting",
    ]);
  });

  it("an empty fleet draws nothing — the core still has the stage", () => {
    expect(buildSceneNodes([], () => "idle")).toEqual([]);
  });
});
