import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionViewerStore } from "./session-viewer-store.js";
import { useLiveSessionsStore } from "./live-sessions-store.js";

describe("session-viewer store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("open sets the watched delegation; open replaces it; close clears", () => {
    const viewer = useSessionViewerStore();

    expect(viewer.isOpen).toBe(false);

    viewer.open("partial-1");
    expect(viewer.isOpen).toBe(true);
    expect(viewer.currentSessionId).toBe("partial-1");

    viewer.open("partial-2");
    expect(viewer.currentSessionId).toBe("partial-2");

    viewer.close();
    expect(viewer.isOpen).toBe(false);
    expect(viewer.currentSessionId).toBeNull();
  });
});

describe("live-sessions store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("begin registers a view, ingest folds events, end removes it", () => {
    const live = useLiveSessionsStore();

    live.begin("s1");
    live.ingest("s1", {
      kind: "text-chunk",
      messageId: "m1",
      textDelta: "hi ",
    });
    live.ingest("s1", {
      kind: "text-chunk",
      messageId: "m1",
      textDelta: "there",
    });

    // test: correct expectation — the view is segmented by assistant message
    // now (live/settled layout parity); the fold lands in m1's segment.
    expect(live.liveFor("s1")?.segments[0]?.text).toBe("hi there");

    live.end("s1");
    expect(live.liveFor("s1")).toBeNull();
  });

  it("ignores events for unregistered sessions", () => {
    const live = useLiveSessionsStore();

    live.ingest("ghost", { kind: "turn-stream-ended" });

    expect(live.liveFor("ghost")).toBeNull();
  });
});

describe("session-viewer store — the focused-agent drill-down", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("openAgent lands directly on the agent with no Back (a thread card's chip)", () => {
    const viewer = useSessionViewerStore();
    viewer.openAgent("trace-1", "tu_agent_1");
    expect(viewer.isOpen).toBe(true);
    expect(viewer.currentSessionId).toBe("trace-1");
    expect(viewer.focusedAgentToolUseId).toBe("tu_agent_1");
    expect(viewer.agentBackAvailable).toBe(false);
  });

  it("focusAgent from an open trace gets Back; Back returns to the trace", () => {
    const viewer = useSessionViewerStore();
    viewer.open("trace-1");
    viewer.focusAgent("tu_agent_1");
    expect(viewer.focusedAgentToolUseId).toBe("tu_agent_1");
    expect(viewer.agentBackAvailable).toBe(true);

    viewer.clearAgentFocus();
    expect(viewer.focusedAgentToolUseId).toBeNull();
    expect(viewer.currentSessionId).toBe("trace-1"); // still on the trace
  });

  it("open and close both reset any agent focus", () => {
    const viewer = useSessionViewerStore();
    viewer.openAgent("trace-1", "tu_agent_1");
    viewer.open("trace-2");
    expect(viewer.focusedAgentToolUseId).toBeNull();

    viewer.focusAgent("tu_agent_2");
    viewer.close();
    expect(viewer.isOpen).toBe(false);
    expect(viewer.focusedAgentToolUseId).toBeNull();
    expect(viewer.agentBackAvailable).toBe(false);
  });

  it("focusAgent without an open trace is a no-op", () => {
    const viewer = useSessionViewerStore();
    viewer.focusAgent("tu_agent_1");
    expect(viewer.isOpen).toBe(false);
    expect(viewer.focusedAgentToolUseId).toBeNull();
  });
});
