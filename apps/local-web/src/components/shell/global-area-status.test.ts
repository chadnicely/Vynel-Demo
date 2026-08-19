// The shell's global light covers the assistant thread AND the spoken thread
// under it. A voice turn that failed, or one parked on a card, used to light
// nothing anywhere in the app.

import { describe, expect, it } from "vitest";
import { foldGlobalAreaStatus } from "./global-area-status.js";

describe("foldGlobalAreaStatus", () => {
  it("is the global status alone until the voice thread exists", () => {
    expect(foldGlobalAreaStatus("completed", null)).toBe("completed");
    expect(foldGlobalAreaStatus("not_running", null)).toBe("not_running");
  });

  it("takes the more urgent of the two, on the app's one precedence", () => {
    expect(foldGlobalAreaStatus("not_running", "problem")).toBe("problem");
    expect(foldGlobalAreaStatus("running", "needs_input")).toBe("needs_input");
    expect(foldGlobalAreaStatus("problem", "running")).toBe("problem");
    expect(foldGlobalAreaStatus("needs_input", "completed")).toBe("needs_input");
  });

  it("a quiet voice thread never quiets a busy global one", () => {
    expect(foldGlobalAreaStatus("running", "idle")).toBe("running");
    expect(foldGlobalAreaStatus("problem", "idle")).toBe("problem");
  });

  it("maps the session ladder's `idle` onto the room ladder's `not_running`", () => {
    expect(foldGlobalAreaStatus("not_running", "idle")).toBe("not_running");
  });
});
