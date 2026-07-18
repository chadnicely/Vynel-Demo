import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useUiStore } from "./ui-store.js";

describe("ui-store theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "";
    setActivePinia(createPinia());
  });

  it("defaults to dark and stamps it on the document", () => {
    const ui = useUiStore();

    expect(ui.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggle flips the theme, the document attribute, and persists", () => {
    const ui = useUiStore();

    ui.toggleTheme();

    expect(ui.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("vynel.theme")).toBe("light");
  });

  it("restores a persisted theme on a fresh store", () => {
    localStorage.setItem("vynel.theme", "light");

    const ui = useUiStore();

    expect(ui.theme).toBe("light");
  });
});

describe("ui-store active workspace", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("restores a persisted workspace id on a fresh store", () => {
    localStorage.setItem("vynel.active-workspace", "demo-ws-marketing");

    const ui = useUiStore();

    expect(ui.activeWorkspaceId).toBe("demo-ws-marketing");
  });

  it("persists a workspace selection", async () => {
    const ui = useUiStore();

    ui.activeWorkspaceId = "demo-ws-bookkeeping";
    await nextTick();

    expect(localStorage.getItem("vynel.active-workspace")).toBe(
      "demo-ws-bookkeeping",
    );
  });

  it("removes the key when the selection clears", async () => {
    localStorage.setItem("vynel.active-workspace", "demo-ws-marketing");
    const ui = useUiStore();

    ui.activeWorkspaceId = null;
    await nextTick();

    expect(localStorage.getItem("vynel.active-workspace")).toBeNull();
  });
});

describe("ui-store composer selections", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("persists the session mode and restores it on a fresh store", async () => {
    const ui = useUiStore();
    ui.composerMode = "bypass";
    await nextTick();
    expect(localStorage.getItem("vynel.composer-mode")).toBe("bypass");

    setActivePinia(createPinia());
    expect(useUiStore().composerMode).toBe("bypass");
  });

  it("falls back to the default for an unknown stored mode or model", () => {
    localStorage.setItem("vynel.composer-mode", "yolo");
    localStorage.setItem("vynel.composer-model", "gpt-99");
    const ui = useUiStore();
    expect(ui.composerMode).toBe("ask");
    expect(ui.composerModelId).toBe("claude-opus-4-8");
  });

  it("persists the model selection", async () => {
    const ui = useUiStore();
    ui.composerModelId = "claude-haiku-4-5";
    await nextTick();
    expect(localStorage.getItem("vynel.composer-model")).toBe("claude-haiku-4-5");

    setActivePinia(createPinia());
    expect(useUiStore().composerModelId).toBe("claude-haiku-4-5");
  });
});
