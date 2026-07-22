import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { useUiStore } from "../stores/ui-store.js";
import { planIdFromAppLink, useAppLinkRouter } from "./use-app-link-router.js";

afterEach(() => {
  document.body.innerHTML = "";
});

// A host standing in for AppShell: installs the router, renders anchors the
// way sanitized assistant markdown does (plain <a>, no Vue handlers).
const Host = defineComponent({
  setup() {
    useAppLinkRouter();
    return () =>
      h("div", [
        h("a", { href: "vynel://plan/p_1" }, "Launch day"),
        h("a", { href: "https://example.com" }, "outside"),
      ]);
  },
});

function mountHost() {
  const pinia = createPinia();
  const wrapper = mount(Host, {
    global: { plugins: [pinia] },
    attachTo: document.body,
  });
  return { wrapper, ui: useUiStore(pinia) };
}

describe("planIdFromAppLink", () => {
  it("parses a plan link and rejects everything else", () => {
    expect(planIdFromAppLink("vynel://plan/p_1")).toBe("p_1");
    expect(planIdFromAppLink("vynel://plan/")).toBeNull();
    expect(planIdFromAppLink("vynel://other/p_1")).toBeNull();
    expect(planIdFromAppLink("https://example.com")).toBeNull();
  });

  it("matches the scheme case-insensitively (DOMPurify admits VYNEL:// too) but keeps the id's case", () => {
    expect(planIdFromAppLink("VYNEL://PLAN/p_Xy")).toBe("p_Xy");
  });
});

describe("useAppLinkRouter", () => {
  it("intercepts a vynel://plan click: opens the shared viewer, never navigates", async () => {
    const { wrapper, ui } = mountHost();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.get('a[href="vynel://plan/p_1"]').element.dispatchEvent(event);

    expect(ui.viewingPlanId).toBe("p_1");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves ordinary links alone", () => {
    const { wrapper, ui } = mountHost();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.get('a[href="https://example.com"]').element.dispatchEvent(event);

    expect(ui.viewingPlanId).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const { wrapper, ui } = mountHost();
    const anchor = wrapper.get('a[href="vynel://plan/p_1"]').element;
    wrapper.unmount();

    document.body.appendChild(anchor);
    anchor.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(ui.viewingPlanId).toBeNull();
  });
});
