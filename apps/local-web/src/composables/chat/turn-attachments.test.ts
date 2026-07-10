import { describe, expect, it } from "vitest";
import {
  filesToTurnAttachments,
  resolveAttachmentMimeType,
} from "./turn-attachments.js";

describe("resolveAttachmentMimeType", () => {
  it("accepts a browser-reported allowlisted type", () => {
    const file = new File(["x"], "shot.png", { type: "image/png" });
    expect(resolveAttachmentMimeType(file)).toBe("image/png");
  });

  it("falls back to the extension when the browser reports nothing", () => {
    const file = new File(["# notes"], "notes.md", { type: "" });
    expect(resolveAttachmentMimeType(file)).toBe("text/markdown");
  });

  it("rejects a type outside the allowlist", () => {
    const file = new File(["MZ"], "setup.exe", {
      type: "application/x-msdownload",
    });
    expect(resolveAttachmentMimeType(file)).toBeNull();
  });
});

describe("filesToTurnAttachments", () => {
  it("encodes accepted files and reports rejects by name", async () => {
    const image = new File(["fake-bytes"], "shot.png", { type: "image/png" });
    const blocked = new File(["MZ"], "setup.exe", {
      type: "application/x-msdownload",
    });

    const { attachments, rejectedNames } = await filesToTurnAttachments([
      image,
      blocked,
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.filename).toBe("shot.png");
    expect(attachments[0]!.mimeType).toBe("image/png");
    expect(Buffer.from(attachments[0]!.base64Data, "base64").toString()).toBe(
      "fake-bytes",
    );
    expect(rejectedNames).toEqual(["setup.exe"]);
  });

  it("rejects a file over the size cap", async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", {
      type: "image/png",
    });
    const { attachments, rejectedNames } = await filesToTurnAttachments([big]);
    expect(attachments).toHaveLength(0);
    expect(rejectedNames).toEqual(["huge.png"]);
  });
});
