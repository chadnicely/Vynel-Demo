import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOnboardingStore } from "./onboarding-store.js";

describe("useOnboardingStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("parks the door the finished wizard chose and hands it out exactly once", () => {
    const store = useOnboardingStore();
    store.markRequired();
    expect(store.isRequired).toBe(true);

    store.markCompleted("new");
    expect(store.isRequired).toBe(false);
    expect(store.pendingFirstProjectDoor).toBe("new");

    expect(store.takeFirstProjectDoor()).toBe("new");
    // Read-once: a later shell re-render must not reopen the dialog.
    expect(store.takeFirstProjectDoor()).toBeNull();
    expect(store.pendingFirstProjectDoor).toBeNull();
  });

  it("completes with no door when the wizard was not the thing that finished", () => {
    const store = useOnboardingStore();
    store.markCompleted();
    expect(store.takeFirstProjectDoor()).toBeNull();
  });
});
