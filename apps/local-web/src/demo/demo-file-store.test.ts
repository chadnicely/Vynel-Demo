import { describe, expect, it } from "vitest";
import { getDemoFileContent, saveDemoFileContent } from "./demo-file-store.js";

describe("demo file store", () => {
  it("reads fixture content by nested path", () => {
    const content = getDemoFileContent("demo-ws-marketing", "site/pricing.md");

    expect(content).toContain("Pro — $49/mo");
  });

  it("returns empty for files without content or unknown paths", () => {
    expect(
      getDemoFileContent("demo-ws-marketing", "site/assets/logo.svg"),
    ).toBe("");
    expect(getDemoFileContent("demo-ws-marketing", "nope/missing.md")).toBe("");
  });

  it("save overrides the fixture content for later reads", () => {
    saveDemoFileContent(
      "demo-ws-research",
      "competitor-notes.md",
      "# Rewritten\n",
    );

    expect(getDemoFileContent("demo-ws-research", "competitor-notes.md")).toBe(
      "# Rewritten\n",
    );
  });
});
