import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import Modal from "./Modal.vue";
import { useOpenModalCount } from "./modal-registry.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Modal", () => {
  it("renders title, description and body when open", async () => {
    mount(Modal, {
      props: { open: true, title: "Add memory", description: "Teach Claude." },
      slots: { default: "<p>Body content</p>" },
      attachTo: document.body,
    });
    await flushPromises();

    expect(document.body.textContent).toContain("Add memory");
    expect(document.body.textContent).toContain("Teach Claude.");
    expect(document.body.textContent).toContain("Body content");
  });

  it("renders nothing when closed", async () => {
    mount(Modal, {
      props: { open: false, title: "Add memory" },
      slots: { default: "<p>Body content</p>" },
      attachTo: document.body,
    });
    await flushPromises();

    expect(document.body.textContent).not.toContain("Body content");
  });

  // The registry is module-global (that's the point) — assert DELTAS so the
  // test holds regardless of what else ran in this file.
  it("reports open state to the shared registry, balancing on close and unmount", async () => {
    const count = useOpenModalCount();
    const before = count.value;

    const wrapper = mount(Modal, {
      props: { open: true, title: "Add memory" },
      attachTo: document.body,
    });
    await flushPromises();
    expect(count.value).toBe(before + 1);

    await wrapper.setProps({ open: false });
    expect(count.value).toBe(before);

    await wrapper.setProps({ open: true });
    expect(count.value).toBe(before + 1);
    wrapper.unmount();
    expect(count.value).toBe(before);
  });
});
