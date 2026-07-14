import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import Modal from "./Modal.vue";

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
});
