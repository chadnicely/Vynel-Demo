import { describe, expect, it } from "vitest";
import { resolveFileLinkTarget } from "./file-link-target.js";

const workspaces = [
  { id: "ws-proj", path: "C:\\Users\\me\\proj" },
  { id: "ws-nested", path: "C:/Users/me/proj/packages/app" },
  { id: "ws-posix", path: "/home/me/site/" },
];

describe("resolveFileLinkTarget", () => {
  it("lands an absolute path in the room whose folder contains it, relative and forward-slashed", () => {
    expect(
      resolveFileLinkTarget("C:\\Users\\me\\proj\\docs\\plan.md", {
        workspaces,
        activeWorkspaceId: null,
      }),
    ).toEqual({ workspaceId: "ws-proj", relativePath: "docs/plan.md" });
    expect(
      resolveFileLinkTarget("/home/me/site/src/index.ts:12:4", {
        workspaces,
        activeWorkspaceId: null,
      }),
    ).toEqual({ workspaceId: "ws-posix", relativePath: "src/index.ts" });
  });

  it("prefers the deepest room when rooms nest, and ignores case and slash style", () => {
    expect(
      resolveFileLinkTarget("c:/users/ME/proj/packages/app/src/a.ts", {
        workspaces,
        activeWorkspaceId: null,
      }),
    ).toEqual({ workspaceId: "ws-nested", relativePath: "src/a.ts" });
  });

  it("a relative path belongs to the room the person is on — and to nothing on the global surface", () => {
    expect(
      resolveFileLinkTarget("./src/pricing.ts:3", { workspaces, activeWorkspaceId: "ws-proj" }),
    ).toEqual({ workspaceId: "ws-proj", relativePath: "src/pricing.ts" });
    expect(resolveFileLinkTarget("src/pricing.ts", { workspaces, activeWorkspaceId: null })).toBeNull();
    // A backslashed tail is an absolute path's remainder, never a room file.
    expect(
      resolveFileLinkTarget("Doe\\proj\\src\\a.ts", { workspaces, activeWorkspaceId: "ws-proj" }),
    ).toBeNull();
  });

  it("a file outside every room, or a room's folder itself, opens nothing", () => {
    expect(
      resolveFileLinkTarget("C:\\Users\\me\\elsewhere\\notes.md", {
        workspaces,
        activeWorkspaceId: "ws-proj",
      }),
    ).toBeNull();
    expect(
      resolveFileLinkTarget("C:\\Users\\me\\proj", { workspaces, activeWorkspaceId: null }),
    ).toBeNull();
    expect(resolveFileLinkTarget("   ", { workspaces, activeWorkspaceId: "ws-proj" })).toBeNull();
  });
});
