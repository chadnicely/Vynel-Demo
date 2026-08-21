import { beforeEach, describe, expect, it } from "vitest";
import { computed, defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createAppRouter } from "../../router.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useViewMode, type ViewModeReading } from "./use-view-mode.js";

async function mountReading(startPath: string, displayActive = false) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createAppRouter();
  await router.push(startPath);
  await router.isReady();
  const isDisplayActive = ref(displayActive);
  let reading!: ViewModeReading;
  mount(
    defineComponent({
      setup() {
        reading = useViewMode(computed(() => isDisplayActive.value));
        return () => h("div");
      },
    }),
    { global: { plugins: [router, pinia] } },
  );
  return { reading, router, isDisplayActive, ui: useUiStore() };
}

// ONE derivation of what the switch shows: the route says Nodes, the Display
// toggle says Display, everything else is normal — and full view is only ever
// a property of the first two.
describe("useViewMode", () => {
  beforeEach(() => localStorage.clear());

  it("reads nodes from the route", async () => {
    const { reading } = await mountReading("/nodes");
    expect(reading.viewMode.value).toBe("nodes");
  });

  it("reads display from the toggle, and normal from everything else", async () => {
    const { reading, isDisplayActive } = await mountReading("/chat");
    expect(reading.viewMode.value).toBe("normal");
    isDisplayActive.value = true;
    expect(reading.viewMode.value).toBe("display");
  });

  it("follows the route as it changes", async () => {
    const { reading, router } = await mountReading("/chat");
    await router.push("/nodes");
    expect(reading.viewMode.value).toBe("nodes");
    await router.push("/home");
    expect(reading.viewMode.value).toBe("normal");
  });

  // The store's flag is sticky for the session, but the normal view is always
  // exactly as it is: the reading says "not full" there whatever the flag holds.
  it("full view only ever applies to a full-capable view", async () => {
    const { reading, router, ui } = await mountReading("/nodes");
    expect(reading.isFullView.value).toBe(false);

    ui.isFullView = true;
    expect(reading.isFullView.value).toBe(true);

    await router.push("/chat");
    expect(reading.isFullView.value).toBe(false);
    expect(ui.isFullView).toBe(true);

    await router.push("/nodes");
    expect(reading.isFullView.value).toBe(true);
  });
});
