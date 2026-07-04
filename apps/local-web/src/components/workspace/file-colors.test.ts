import { describe, expect, it } from "vitest";
import { fileColorFamily } from "./file-colors.js";

describe("fileColorFamily", () => {
  it("maps common extensions to their families", () => {
    expect(fileColorFamily("pricing.md")).toBe("doc");
    expect(fileColorFamily("ledger.CSV")).toBe("data");
    expect(fileColorFamily("hero.png")).toBe("image");
    expect(fileColorFamily("main.vue")).toBe("code");
  });

  it("falls back to plain for unknown or missing extensions", () => {
    expect(fileColorFamily("notes.unknownext")).toBe("plain");
    expect(fileColorFamily("LICENSE")).toBe("plain");
  });
});
