import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAppSidebarStore } from "./app-sidebar-store.js";

describe("useAppSidebarStore", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("opening from a thread REPLACES the stack; push drills; Back walks; close clears", () => {
    const sidebar = useAppSidebarStore();
    expect(sidebar.isOpen).toBe(false);

    sidebar.openSession({ sessionId: "s1", title: "July run", anchorTraceId: "t1" });
    expect(sidebar.activeNode).toMatchObject({
      kind: "session",
      sessionId: "s1",
      anchorTraceId: "t1",
    });

    // A fresh open from a thread replaces — never a runaway stack.
    sidebar.openWorkspace({ workspaceId: "w1" });
    expect(sidebar.stack).toHaveLength(1);
    expect(sidebar.activeNode).toMatchObject({
      kind: "workspace",
      workspaceId: "w1",
      anchorTraceId: null,
    });

    // A pointer clicked INSIDE the sidebar pushes; Back returns.
    sidebar.openSession({ sessionId: "s2", title: "Child" }, { push: true });
    expect(sidebar.stack).toHaveLength(2);
    sidebar.back();
    expect(sidebar.activeNode).toMatchObject({ kind: "workspace" });

    sidebar.close();
    expect(sidebar.isOpen).toBe(false);
  });

  it("push on an EMPTY stack still opens — never a stranded push", () => {
    const sidebar = useAppSidebarStore();
    sidebar.openSession({ sessionId: "s1", title: "T" }, { push: true });
    expect(sidebar.stack).toHaveLength(1);
  });
});
