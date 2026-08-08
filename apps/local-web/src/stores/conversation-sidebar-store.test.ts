import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConversationSidebarStore } from "./conversation-sidebar-store.js";

// test: correct expectation — the push/back stack is gone (Chad, 2026-08-09):
// EVERY open replaces the panel, including a pointer clicked inside it.
// Forward-only hops, no back navigation.
describe("useConversationSidebarStore", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("every open REPLACES the panel; close clears", () => {
    const sidebar = useConversationSidebarStore();
    expect(sidebar.isOpen).toBe(false);

    sidebar.openSession({
      sessionId: "s1",
      title: "July run",
      anchorTraceId: "t1",
    });
    expect(sidebar.activeNode).toMatchObject({
      kind: "session",
      sessionId: "s1",
      anchorTraceId: "t1",
    });

    sidebar.openWorkspace({ workspaceId: "w1" });
    expect(sidebar.activeNode).toMatchObject({
      kind: "workspace",
      workspaceId: "w1",
      anchorTraceId: null,
    });

    // The forward hop: a pointer inside the panel swaps the node in place.
    sidebar.openSession({ sessionId: "s2", title: "Child" });
    expect(sidebar.activeNode).toMatchObject({
      kind: "session",
      sessionId: "s2",
    });

    sidebar.close();
    expect(sidebar.isOpen).toBe(false);
    expect(sidebar.activeNode).toBeNull();
  });
});
