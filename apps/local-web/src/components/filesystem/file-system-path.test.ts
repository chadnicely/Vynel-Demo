import { describe, expect, it } from "vitest";
import {
  basenameOfPath,
  driveDisplayName,
  formatBytesLikeExplorer,
  isDriveRootPath,
  isPathWithin,
  rootOfPath,
  splitPathIntoCrumbs,
} from "./file-system-path.js";

describe("file-system-path", () => {
  it("splits a Windows path into root + folder crumbs with absolute targets", () => {
    expect(splitPathIntoCrumbs("E:\\KLONE\\Workspace")).toEqual([
      { name: "E:\\", path: "E:\\" },
      { name: "KLONE", path: "E:\\KLONE" },
      { name: "Workspace", path: "E:\\KLONE\\Workspace" },
    ]);
  });

  it("splits a POSIX path the same way", () => {
    expect(splitPathIntoCrumbs("/home/chad/docs")).toEqual([
      { name: "/", path: "/" },
      { name: "home", path: "/home" },
      { name: "chad", path: "/home/chad" },
      { name: "docs", path: "/home/chad/docs" },
    ]);
  });

  it("knows roots and basenames on both flavours", () => {
    expect(rootOfPath("C:\\Users\\chad")).toBe("C:\\");
    expect(rootOfPath("/usr/local")).toBe("/");
    expect(isDriveRootPath("C:\\")).toBe(true);
    expect(isDriveRootPath("C:\\Users")).toBe(false);
    expect(isDriveRootPath("/")).toBe(true);
    expect(basenameOfPath("C:\\Users\\chad\\")).toBe("chad");
    expect(basenameOfPath("/home/chad")).toBe("chad");
    expect(basenameOfPath("E:\\")).toBe("E:");
  });

  it("matches a path within a root case-insensitively on Windows", () => {
    expect(isPathWithin("c:\\users\\chad", "C:\\")).toBe(true);
    expect(isPathWithin("D:\\x", "C:\\")).toBe(false);
    expect(isPathWithin("C:\\Users\\chad", "C:\\Users\\chad")).toBe(true);
    // A sibling that merely shares a prefix is NOT within.
    expect(isPathWithin("C:\\Users\\chadwick", "C:\\Users\\chad")).toBe(false);
  });

  it("names drives like Explorer: label or kind default, plus the letter", () => {
    expect(driveDisplayName({ path: "E:\\", label: "WORKSPACE", kind: "fixed" })).toBe(
      "WORKSPACE (E:)",
    );
    expect(driveDisplayName({ path: "C:\\", label: null, kind: "fixed" })).toBe(
      "Local Disk (C:)",
    );
    expect(driveDisplayName({ path: "G:\\", label: null, kind: "removable" })).toBe(
      "USB Drive (G:)",
    );
    expect(driveDisplayName({ path: "/", label: "Root", kind: "fixed" })).toBe("Root");
  });

  it("formats capacity with Explorer's three significant figures", () => {
    const gib = 1024 ** 3;
    expect(formatBytesLikeExplorer(51.2 * gib)).toBe("51.2 GB");
    expect(formatBytesLikeExplorer(7.64 * gib)).toBe("7.64 GB");
    expect(formatBytesLikeExplorer(399 * gib)).toBe("399 GB");
    expect(formatBytesLikeExplorer(512)).toBe("512 bytes");
    // Truncated like Explorer, never rounded up into the next figure.
    expect(formatBytesLikeExplorer(29.999 * gib)).toBe("29.9 GB");
    expect(formatBytesLikeExplorer(99.999 * gib)).toBe("99.9 GB");
  });
});
