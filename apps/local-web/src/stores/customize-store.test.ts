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

  it("a custom colour and a palette slot are one choice; the hex survives reload, junk does not", () => {
    const store = useCustomizeStore();

    store.setColorSlot("w1", 4);
    store.setCustomColor("w1", "#1E90FF");
    expect(store.customizationFor("w1")).toMatchObject({ colorSlot: null, customColor: "#1e90ff" });

    store.setColorSlot("w1", 2);
    expect(store.customizationFor("w1")).toMatchObject({ colorSlot: 2, customColor: null });

    // Not a #rrggbb → ignored, nothing changes.
    store.setCustomColor("w1", "blue");
    expect(store.customizationFor("w1")).toMatchObject({ colorSlot: 2, customColor: null });

    store.setCustomColor("w1", "#abcdef");
    setActivePinia(createPinia());
    expect(useCustomizeStore().customizationFor("w1").customColor).toBe("#abcdef");

    // A corrupt stored hex reads as no custom colour.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    stored.w1.customColor = "javascript:alert(1)";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    setActivePinia(createPinia());
    expect(useCustomizeStore().customizationFor("w1").customColor).toBeNull();
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

describe("customize-store server sync", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  type Saved = { scopeKey: string; body: unknown };
  function makeClient(remote: { scopes: unknown[]; treeLayout: unknown }) {
    const saved: Saved[] = [];
    const layouts: unknown[] = [];
    const client = {
      customizations: {
        list: async () => remote,
        saveScope: async (scopeKey: string, body: unknown) => {
          saved.push({ scopeKey, body });
          return { scopeKey, ...(body as object) };
        },
        saveTreeLayout: async (layout: unknown) => {
          layouts.push(layout);
          return layout;
        },
      },
    };
    return { client: client as never, saved, layouts };
  }

  const remoteScope = {
    ...defaultCustomization(),
    scopeKey: "w1",
    colorSlot: 5,
  };

  it("hydrate: the server's row wins over the local cache; a local-only scope is pushed up", async () => {
    const local = useCustomizeStore();
    local.setColorSlot("w1", 2); // stale local cache for w1
    local.setColorSlot("w2", 3); // only this browser knows w2
    // Simulate a fresh boot: dirty flags cleared as if last session synced.
    localStorage.setItem("vynel.customize.dirty", "[]");
    setActivePinia(createPinia());
    const store = useCustomizeStore();
    const { client, saved } = makeClient({ scopes: [remoteScope], treeLayout: null });

    await store.hydrate(client);

    expect(store.customizationFor("w1").colorSlot).toBe(5);
    expect(saved.map((s) => s.scopeKey)).toEqual(["w2"]);
    expect((saved[0]!.body as { colorSlot: number }).colorSlot).toBe(3);
    expect(store.saveState).toBe("saved");
  });

  it("hydrate: a scope still dirty from a closed window beats the server's older row", async () => {
    const local = useCustomizeStore();
    local.setColorSlot("w1", 2); // dirty, never pushed (no client)
    setActivePinia(createPinia());
    const store = useCustomizeStore();
    const { client, saved } = makeClient({ scopes: [remoteScope], treeLayout: null });

    await store.hydrate(client);

    expect(store.customizationFor("w1").colorSlot).toBe(2);
    expect(saved.map((s) => s.scopeKey)).toEqual(["w1"]);
  });

  it("hydrate: the tree layout comes from the server, else the local one is carried up", async () => {
    localStorage.setItem("vynel.tree.order", JSON.stringify({ groups: ["g1"], workspaces: {} }));
    const store = useCustomizeStore();
    const remoteLayout = { groups: ["g2", "g1"], workspaces: { root: ["w1"] } };
    const { client, layouts } = makeClient({ scopes: [], treeLayout: remoteLayout });
    await store.hydrate(client);
    expect(store.treeLayout).toEqual(remoteLayout);
    expect(layouts).toEqual([]);

    setActivePinia(createPinia());
    localStorage.clear();
    localStorage.setItem("vynel.tree.order", JSON.stringify({ groups: ["g1"], workspaces: {} }));
    const fresh = useCustomizeStore();
    const carried = makeClient({ scopes: [], treeLayout: null });
    await fresh.hydrate(carried.client);
    expect(carried.layouts).toEqual([{ groups: ["g1"], workspaces: {} }]);
  });

  it("autosave: a change after hydrate pushes the whole scope; a drop pushes the layout", async () => {
    const store = useCustomizeStore();
    const { client, saved, layouts } = makeClient({ scopes: [], treeLayout: null });
    await store.hydrate(client);

    store.setPersonaCustomColor("w1", "#ABCDEF");
    store.setTreeLayout({ groups: [], workspaces: { root: ["w1"] } });
    await store.flush();

    expect(saved).toHaveLength(1);
    expect(saved[0]!.body).toMatchObject({ personaCustomColor: "#abcdef", personaColorSlot: null });
    expect(layouts).toEqual([{ groups: [], workspaces: { root: ["w1"] } }]);
    expect(store.isCustomized("w1")).toBe(true);
    store.reset("w1");
    expect(store.isCustomized("w1")).toBe(false);
  });
});

describe("customize-store sync — resilience", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("an edit made while a scope's save is in flight is still pushed afterwards", async () => {
    const store = useCustomizeStore();
    const saved: Array<{ scopeKey: string; colorSlot: number | null }> = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const client = {
      customizations: {
        list: async () => ({ scopes: [], treeLayout: null }),
        saveScope: async (scopeKey: string, body: { colorSlot: number | null }) => {
          saved.push({ scopeKey, colorSlot: body.colorSlot });
          if (first) {
            first = false;
            await gate;
          }
          return { scopeKey, ...body };
        },
        saveTreeLayout: async (layout: unknown) => layout,
      },
    } as never;
    await store.hydrate(client);

    store.setColorSlot("w1", 1);
    const inFlight = store.flush(); // PUT #1 leaves with colorSlot 1 and hangs
    store.setColorSlot("w1", 2); // edited while it's in flight
    release();
    await inFlight;
    await store.flush(); // the newer value must go out too
    expect(saved.map((s) => s.colorSlot)).toEqual([1, 2]);
    expect(store.saveState).toBe("saved");
  });

  it("a rejected (4xx) scope drops its mark and never blocks the others; a 5xx keeps retrying", async () => {
    const store = useCustomizeStore();
    const { SdkError } = await import("@vynel/sdk");
    const attempts: string[] = [];
    const client = {
      customizations: {
        list: async () => ({ scopes: [], treeLayout: null }),
        saveScope: async (scopeKey: string, body: unknown) => {
          attempts.push(scopeKey);
          if (scopeKey === "bad") {
            throw new SdkError(new Response("nope", { status: 400 }), { message: "bad row" });
          }
          if (scopeKey === "flaky" && attempts.filter((k) => k === "flaky").length === 1) {
            throw new SdkError(new Response("boom", { status: 503 }), { message: "down" });
          }
          return { scopeKey, ...(body as object) };
        },
        saveTreeLayout: async (layout: unknown) => layout,
      },
    } as never;
    await store.hydrate(client);

    store.setColorSlot("bad", 1);
    store.setColorSlot("flaky", 2);
    store.setColorSlot("good", 3);
    await store.flush();
    expect(attempts.sort()).toEqual(["bad", "flaky", "good"]);
    expect(store.saveState).toBe("error");

    // Next flush: bad is gone for good (rejected), flaky retries and lands.
    await store.flush();
    expect(attempts.filter((k) => k === "bad")).toHaveLength(1);
    expect(attempts.filter((k) => k === "flaky")).toHaveLength(2);
    expect(store.saveState).toBe("saved");
  });

  it("hydrate never rejects — an engine that's down leaves the cache in force and says so", async () => {
    const local = useCustomizeStore();
    local.setColorSlot("w1", 4);
    setActivePinia(createPinia());
    const store = useCustomizeStore();
    const client = {
      customizations: {
        list: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
    } as never;
    await expect(store.hydrate(client)).resolves.toBeUndefined();
    expect(store.customizationFor("w1").colorSlot).toBe(4);
    expect(store.saveState).toBe("error");
  });
});
