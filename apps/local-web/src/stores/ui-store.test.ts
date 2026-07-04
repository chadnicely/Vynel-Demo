import { beforeEach, describe, expect, it } from "vitest";
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
