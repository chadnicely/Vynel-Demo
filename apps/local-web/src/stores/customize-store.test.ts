import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  defaultCustomization,
  useCustomizeStore,
} from "./customize-store.js";
import { WORKSPACE_SECTIONS } from "../components/workspace/workspace-sections.js";

const STORAGE_KEY = "vynel.customize";

describe("customize-store", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("an untouched workspace reads the catalog default and stores nothing", () => {
    const store = useCustomizeStore();

    const config = store.customizationFor("w1");

    expect(config).toEqual(defaultCustomization());
    expect(config.entries.map((entry) => entry.sectionId)).toEqual(
      WORKSPACE_SECTIONS.map((section) => section.id),
    );
    expect(store.isCustomized("w1")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("hide, regroup, and reorder persist per workspace and reload", () => {
    const store = useCustomizeStore();

    store.setHidden("w1", "journal", true);
    store.setGroup("w1", "schedules", "connections");
    store.moveEntry("w1", "tasks", -1);

    // Another workspace stays default.
    expect(store.customizationFor("w2")).toEqual(defaultCustomization());

    // A fresh store (new pinia, same storage) sees the same layout.
    setActivePinia(createPinia());
    const reloaded = useCustomizeStore();
    const config = reloaded.customizationFor("w1");
    expect(
      config.entries.find((entry) => entry.sectionId === "journal")?.isHidden,
    ).toBe(true);
    expect(
      config.entries.find((entry) => entry.sectionId === "schedules")?.groupId,
    ).toBe("connections");
    const order = config.entries.map((entry) => entry.sectionId);
    expect(order.indexOf("tasks")).toBe(order.indexOf("plans") - 1);
  });

  it("custom groups: add, rename, and delete (sections degrade to standalone)", () => {
    const store = useCustomizeStore();

    const groupId = store.addGroup("w1", "Ops");
    store.setGroup("w1", "channels", groupId);
    store.renameGroup("w1", groupId, "Operations");

    let config = store.customizationFor("w1");
    expect(config.groups.at(-1)).toEqual({ id: groupId, label: "Operations" });
    expect(
      config.entries.find((entry) => entry.sectionId === "channels")?.groupId,
    ).toBe(groupId);

    store.removeGroup("w1", groupId);
    config = store.customizationFor("w1");
    expect(config.groups.some((group) => group.id === groupId)).toBe(false);
    expect(
      config.entries.find((entry) => entry.sectionId === "channels")?.groupId,
    ).toBeNull();
  });

  it("assigning to an unknown group is refused", () => {
    const store = useCustomizeStore();

    store.setGroup("w1", "channels", "no-such-group");

    expect(
      store
        .customizationFor("w1")
        .entries.find((entry) => entry.sectionId === "channels")?.groupId,
    ).toBe("connections");
  });

  it("reset returns the workspace to the catalog default", () => {
    const store = useCustomizeStore();

    store.setHidden("w1", "journal", true);
    store.reset("w1");

    expect(store.customizationFor("w1")).toEqual(defaultCustomization());
    expect(store.isCustomized("w1")).toBe(false);
  });

  it("a corrupt stored value falls back to defaults", () => {
    localStorage.setItem(STORAGE_KEY, "not json {");

    const store = useCustomizeStore();

    expect(store.customizationFor("w1")).toEqual(defaultCustomization());
  });

  it("a stored layout reconciles against the current catalog", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        w1: {
          colorSlot: 2,
          groups: [{ id: "custom-1", label: "Mine" }],
          entries: [
            // A section id the catalog no longer has → dropped.
            { sectionId: "retired-section", groupId: null, isHidden: false },
            // A dangling group ref → standalone.
            { sectionId: "agents", groupId: "gone-group", isHidden: false },
            { sectionId: "skills", groupId: "custom-1", isHidden: true },
          ],
        },
      }),
    );

    const store = useCustomizeStore();
    const config = store.customizationFor("w1");

    expect(config.colorSlot).toBe(2);
    const ids = config.entries.map((entry) => entry.sectionId);
    expect(ids).not.toContain("retired-section");
    // Sections the save predates append at the end, visible.
    for (const section of WORKSPACE_SECTIONS) {
      expect(ids).toContain(section.id);
    }
    expect(config.entries[0]).toEqual({
      sectionId: "agents",
      groupId: null,
      isHidden: false,
    });
    expect(config.entries[1]).toEqual({
      sectionId: "skills",
      groupId: "custom-1",
      isHidden: true,
    });
    expect(
      config.entries.find((entry) => entry.sectionId === "tasks")?.isHidden,
    ).toBe(false);
  });

  it("color slot persists independently of the menu layout", () => {
    const store = useCustomizeStore();

    store.setColorSlot("w1", 4);

    expect(store.customizationFor("w1").colorSlot).toBe(4);
    expect(store.customizationFor("w1").entries).toEqual(
      defaultCustomization().entries,
    );
  });
});

describe("customize-store persona image", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("persists per scope and clears to the Claude-mark default", () => {
    const store = useCustomizeStore();

    store.setPersonaImage("global", "data:image/png;base64,AAAA");
    expect(store.customizationFor("global").personaImage).toBe(
      "data:image/png;base64,AAAA",
    );
    // Another scope stays on the default mark.
    expect(store.customizationFor("w1").personaImage).toBeNull();

    // Survives a reload.
    setActivePinia(createPinia());
    const reloaded = useCustomizeStore();
    expect(reloaded.customizationFor("global").personaImage).toBe(
      "data:image/png;base64,AAAA",
    );

    reloaded.setPersonaImage("global", null);
    expect(reloaded.customizationFor("global").personaImage).toBeNull();
  });

  it("stores the WORKSPACE icon per scope, independent of the persona image, and survives reload", () => {
    const store = useCustomizeStore();

    store.setWorkspaceImage("w1", "data:image/png;base64,BBBB");
    expect(store.customizationFor("w1").workspaceImage).toBe(
      "data:image/png;base64,BBBB",
    );
    expect(store.customizationFor("w1").personaImage).toBeNull();

    setActivePinia(createPinia());
    const reloaded = useCustomizeStore();
    expect(reloaded.customizationFor("w1").workspaceImage).toBe(
      "data:image/png;base64,BBBB",
    );
    reloaded.setWorkspaceImage("w1", null);
    expect(reloaded.customizationFor("w1").workspaceImage).toBeNull();
  });
});
