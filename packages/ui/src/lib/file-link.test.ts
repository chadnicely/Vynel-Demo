import { describe, expect, it } from "vitest";
import {
  fileLinkHref,
  filePathFromAppLink,
  findFilePaths,
  isAbsoluteFilePath,
} from "./file-link.js";

const paths = (text: string) => findFilePaths(text).map((hit) => hit.path);

describe("file links", () => {
  it("round-trips a path through the app scheme, spaces and backslashes included", () => {
    const path = "C:\\Users\\me\\My Notes\\plan.md";
    expect(filePathFromAppLink(fileLinkHref(path))).toBe(path);
    expect(filePathFromAppLink("VYNEL://FILE/src%2Fa.ts")).toBe("src/a.ts");
    expect(filePathFromAppLink("vynel://file/")).toBeNull();
    expect(filePathFromAppLink("vynel://plan/p_1")).toBeNull();
    expect(filePathFromAppLink("https://example.com")).toBeNull();
  });

  it("tells an absolute path from a room-relative one", () => {
    expect(isAbsoluteFilePath("C:\\x\\y.ts")).toBe(true);
    expect(isAbsoluteFilePath("/home/me/y.ts")).toBe(true);
    expect(isAbsoluteFilePath("~/y.ts")).toBe(true);
    expect(isAbsoluteFilePath("src/y.ts")).toBe(false);
  });
});

describe("findFilePaths", () => {
  it("spots absolute and relative file paths in prose, line suffix included", () => {
    expect(
      paths("Wrote C:\\Users\\me\\docs\\plan.md and /home/me/app/src/index.ts, then src/pricing.ts:12 too."),
    ).toEqual(["C:\\Users\\me\\docs\\plan.md", "/home/me/app/src/index.ts", "src/pricing.ts:12"]);
  });

  it("a path that ends a sentence is still a path", () => {
    expect(paths("I updated src/pricing.ts.")).toEqual(["src/pricing.ts"]);
    expect(paths("Wrote docs/plan.md and src/a.ts.")).toEqual(["docs/plan.md", "src/a.ts"]);
    // A dotted file name keeps its whole name.
    expect(paths("keep old/a.ts.bak around")).toEqual(["old/a.ts.bak"]);
  });

  it("leaves URLs, package specifiers, bare words, and slashed phrases alone", () => {
    expect(paths("see https://example.com/docs/a.md and/or km/h")).toEqual([]);
    expect(paths("import it from @vynel/ui/src/index.ts")).toEqual([]);
    expect(paths("the file pricing.ts is fine")).toEqual([]);
    expect(paths("version 1.2/3.4")).toEqual([]);
  });

  it("never manufactures a relative link out of a spaced Windows path", () => {
    // A miss, not a wrong link: the tail must not become `<room>/Doe/proj/src/a.ts`.
    expect(paths("C:\\Users\\John Doe\\proj\\src\\a.ts is done")).toEqual([]);
    expect(paths("In C:\\Program Files\\App\\config.json")).toEqual([]);
  });

  it("treats Unicode letters as part of a name", () => {
    expect(paths("open docs/plán/notes.md")).toEqual(["docs/plán/notes.md"]);
  });

  it("reports positions the caller can slice on", () => {
    const text = "open docs/a.md now";
    const [hit] = findFilePaths(text);
    expect(text.slice(hit!.start, hit!.end)).toBe("docs/a.md");
  });
});
