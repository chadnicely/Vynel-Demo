// The two WORD readings of a level, and the bar above them. One rule
// everywhere (Kafi, 2026-08-17): a dot's colour and the words beside it are
// the same status, so a red node can never read "waiting to start".

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { SceneNode } from "../../utils/constellation-scene.js";
import NodesFleetBar from "./NodesFleetBar.vue";
import NodesGrid from "./NodesGrid.vue";
import NodesRace from "./NodesRace.vue";

const node = (id: string, status: SceneNode["status"]): SceneNode => ({
  id: `workspace:${id}`,
  name: id,
  initials: id.slice(0, 2).toUpperCase(),
  status,
});

const everyState: SceneNode[] = [
  node("problem", "problem"),
  node("building", "building"),
  node("waiting", "waiting"),
  node("done", "done"),
  node("idle", "idle"),
];

describe("the word readings share one ladder", () => {
  it("Race says what Grid says — it kept a two-state label the sweep missed", () => {
    const race = mount(NodesRace, { props: { nodes: everyState } });
    const grid = mount(NodesGrid, { props: { nodes: everyState } });
    for (const label of [
      "Needs attention",
      "Working now",
      "Waiting on you",
      "All done",
      "Idle",
    ]) {
      expect(race.text()).toContain(label);
      expect(grid.text()).toContain(label);
    }
    expect(race.text()).not.toContain("waiting to start");
  });
});

describe("NodesFleetBar", () => {
  const mountBar = (trail: readonly string[], hasAnswered = true) =>
    mount(NodesFleetBar, {
      props: { mode: "nodes" as const, nodes: everyState, trail, hasAnswered },
      global: { stubs: { PhCaretLeft: true } },
    });

  it("counts nothing until the level's reads have answered", () => {
    expect(mountBar([], false).find(".counts").exists()).toBe(false);

    const answered = mountBar([]);
    expect(answered.text()).toContain("1 need attention");
    expect(answered.text()).toContain("1 working");
    expect(answered.text()).toContain("1 idle");
  });

  it("out on the fleet there is no crumb at all", () => {
    const bar = mountBar([]);
    expect(bar.find("button.crumb").exists()).toBe(false);
    expect(bar.find(".crumb-here").exists()).toBe(false);
  });

  it("one step in: back to the fleet, standing in the room", () => {
    const bar = mountBar(["Evernote"]);
    expect(bar.find("button.crumb").text()).toContain("All projects");
    expect(bar.find(".crumb-here").text()).toBe("Evernote");
  });

  it("deeper in, `back` names the level above rather than the fleet", () => {
    const bar = mountBar(["Evernote", "Research: pricing"]);
    expect(bar.find("button.crumb").text()).toContain("Evernote");
    expect(bar.find(".crumb-here").text()).toBe("Research: pricing");
  });

  it("emits back — one level, never all the way out", async () => {
    const bar = mountBar(["Evernote"]);
    await bar.find("button.crumb").trigger("click");
    expect(bar.emitted("back")).toHaveLength(1);
  });
});
