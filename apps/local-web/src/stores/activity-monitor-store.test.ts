import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useActivityMonitorStore } from "./activity-monitor-store.js";

describe("activity-monitor store — the node stack", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("open resets the stack to one node; close clears it", () => {
    const store = useActivityMonitorStore();
    expect(store.isOpen).toBe(false);
    expect(store.current).toBeNull();
    expect(store.baseSource).toBeNull();

    store.openTrace("partial-1");
    expect(store.isOpen).toBe(true);
    expect(store.current).toEqual({ kind: "trace", partialSessionId: "partial-1" });
    expect(store.baseSource).toEqual({ kind: "trace", id: "partial-1" });

    // A drilled stack collapses on the next open — never accumulates.
    store.focusAgent("tu_1");
    store.openTrace("partial-2");
    expect(store.stack).toHaveLength(1);
    expect(store.baseSource).toEqual({ kind: "trace", id: "partial-2" });

    store.close();
    expect(store.isOpen).toBe(false);
    expect(store.current).toBeNull();
  });

  it("openSession derives a session base source and carries the label", () => {
    const store = useActivityMonitorStore();
    store.openSession("sdk-1", "Marketing · Launch plan");
    expect(store.current).toEqual({
      kind: "session",
      sessionId: "sdk-1",
      title: "Marketing · Launch plan",
    });
    expect(store.baseSource).toEqual({ kind: "session", id: "sdk-1" });
    expect(store.backAvailable).toBe(false);
  });

  it("openAgentDirect lands on the agent with NO back — the base source is the carried source", () => {
    const store = useActivityMonitorStore();
    store.openAgentDirect({ kind: "trace", id: "partial-1" }, "tu_agent_1");
    expect(store.isOpen).toBe(true);
    expect(store.backAvailable).toBe(false);
    expect(store.current).toEqual({
      kind: "agent",
      source: { kind: "trace", id: "partial-1" },
      toolUseId: "tu_agent_1",
    });
    // The agent node's carried source anchors the monitor.
    expect(store.baseSource).toEqual({ kind: "trace", id: "partial-1" });
  });

  it("openAgentDirect over a SESSION source — a DIRECT turn's agent, no trace involved", () => {
    const store = useActivityMonitorStore();
    store.openAgentDirect({ kind: "session", id: "sdk-1" }, "tu_agent_1");
    expect(store.backAvailable).toBe(false);
    expect(store.current).toEqual({
      kind: "agent",
      source: { kind: "session", id: "sdk-1" },
      toolUseId: "tu_agent_1",
    });
    // The monitor binds to the session the turn ran on.
    expect(store.baseSource).toEqual({ kind: "session", id: "sdk-1" });
  });

  it("focusAgent pushes an agent node carrying the current base source; back pops to it", () => {
    const store = useActivityMonitorStore();
    store.openTrace("partial-1");
    store.focusAgent("tu_agent_1");

    expect(store.backAvailable).toBe(true);
    expect(store.current).toEqual({
      kind: "agent",
      source: { kind: "trace", id: "partial-1" },
      toolUseId: "tu_agent_1",
    });
    // The base source never moves — one monitor serves both levels.
    expect(store.baseSource).toEqual({ kind: "trace", id: "partial-1" });

    store.back();
    expect(store.current).toEqual({ kind: "trace", partialSessionId: "partial-1" });
    expect(store.backAvailable).toBe(false);
  });

  it("agent drill-down from a SESSION node carries the session source", () => {
    const store = useActivityMonitorStore();
    store.openSession("sdk-1", "Assistant");
    store.focusAgent("tu_agent_1");

    expect(store.current).toEqual({
      kind: "agent",
      source: { kind: "session", id: "sdk-1" },
      toolUseId: "tu_agent_1",
    });
    expect(store.baseSource).toEqual({ kind: "session", id: "sdk-1" });
  });

  it("back at depth one is a no-op; focusAgent with nothing open is a no-op", () => {
    const store = useActivityMonitorStore();
    store.focusAgent("tu_ghost");
    expect(store.isOpen).toBe(false);

    store.openTrace("partial-1");
    store.back();
    expect(store.current).toEqual({ kind: "trace", partialSessionId: "partial-1" });
    expect(store.isOpen).toBe(true);
  });
});
