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

  // Escape is Reka's own dismiss path; `persistent` is the one switch that
  // keeps a long form (the workspace wizard) from vanishing on a stray key.
  it("closes on Escape by default, but a persistent modal stays", async () => {
    const plain = mount(Modal, {
      props: { open: true, title: "Plain" },
      attachTo: document.body,
    });
    await flushPromises();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();
    expect(plain.emitted("update:open")?.at(-1)).toEqual([false]);
    plain.unmount();
    document.body.innerHTML = "";

    const persistent = mount(Modal, {
      props: { open: true, title: "Wizard", persistent: true },
      attachTo: document.body,
    });
    await flushPromises();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();
    expect(persistent.emitted("update:open")).toBeUndefined();
    expect(document.body.textContent).toContain("Wizard");
    persistent.unmount();
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
