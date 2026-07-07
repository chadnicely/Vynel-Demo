import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOnboardingStore } from "./onboarding-store.js";

describe("onboarding store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("is off by default and flips with the gate lifecycle", () => {
    const store = useOnboardingStore();
    expect(store.isRequired).toBe(false);

    store.markRequired();
    expect(store.isRequired).toBe(true);

    store.markCompleted();
    expect(store.isRequired).toBe(false);
  });
});
