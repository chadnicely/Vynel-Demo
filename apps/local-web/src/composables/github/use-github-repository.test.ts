import { describe, expect, it } from "vitest";
import { suggestRepositoryName } from "./use-github-repository.js";

describe("suggestRepositoryName", () => {
  it("turns a workspace name into GitHub's naming", () => {
    expect(suggestRepositoryName("Front of House!")).toBe("front-of-house");
    expect(suggestRepositoryName("  Vynel Beta  ")).toBe("vynel-beta");
    expect(suggestRepositoryName("my.app_v2")).toBe("my.app_v2");
  });

  it("never starts with a dash or a dot, never ends with a dash", () => {
    expect(suggestRepositoryName("--Café--")).toBe("caf");
    expect(suggestRepositoryName(".hidden")).toBe("hidden");
  });

  it("is empty when nothing survives, so the screen asks for a name", () => {
    expect(suggestRepositoryName("!!!")).toBe("");
  });
});
