import { beforeEach, describe, expect, it } from "vitest";
import { computed, defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createAppRouter } from "../../router.js";
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
  return { reading, router, isDisplayActive };
}

// ONE derivation of what the switch shows: the route says Nodes, the Display
// toggle says Display, everything else is normal — and Nodes / the Display
// are the full views, the normal view never is.
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

  it("full view is exactly 'a full-capable view is on' — nothing else decides it", async () => {
    const { reading, router, isDisplayActive } = await mountReading("/nodes");
    expect(reading.isFullView.value).toBe(true);

    await router.push("/chat");
    expect(reading.isFullView.value).toBe(false);

    isDisplayActive.value = true;
    expect(reading.isFullView.value).toBe(true);
    isDisplayActive.value = false;
    expect(reading.isFullView.value).toBe(false);
  });
});
