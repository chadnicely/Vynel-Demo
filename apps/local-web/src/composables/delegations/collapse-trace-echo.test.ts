import { describe, expect, it } from "vitest";
import { collapseTraceEcho } from "./collapse-trace-echo.js";

describe("collapseTraceEcho", () => {
  it("hides the surfaced report when it echoes the workspace reply", () => {
    const entries = [
      { id: "t", role: "user", body: "list all files" },
      { id: "reply", role: "assistant", body: "There are 3 files." },
      { id: "report", role: "assistant", body: "There are 3 files." }, // the echo
    ];
    expect(collapseTraceEcho(entries).map((entry) => entry.id)).toEqual(["t", "reply"]);
  });

  it("keeps distinct assistant messages and all user rows", () => {
    const entries = [
      { id: "t", role: "user", body: "do the thing" },
      { id: "a1", role: "assistant", body: "Working on it." },
      { id: "a2", role: "assistant", body: "Done." },
      { id: "t2", role: "user", body: "do the thing" }, // user repeats always render
    ];
    expect(collapseTraceEcho(entries)).toHaveLength(4);
  });

  it("treats whitespace-only differences as the same body", () => {
    const entries = [
      { id: "a1", role: "assistant", body: "Done." },
      { id: "a2", role: "assistant", body: "  Done.\n" },
    ];
    expect(collapseTraceEcho(entries).map((entry) => entry.id)).toEqual(["a1"]);
  });
});
