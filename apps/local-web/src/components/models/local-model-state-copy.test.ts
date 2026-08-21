import { describe, expect, it } from "vitest";
import type { LocalModelStatusResponse } from "@vynel/contracts/models/local-models-http";
import { describeLocalModelState } from "./local-model-state-copy.js";

function model(overrides: Partial<LocalModelStatusResponse>): LocalModelStatusResponse {
  return {
    id: "kokoro",
    kind: "tts",
    label: "Kokoro",
    description: "Natural voice.",
    approxBytes: 340_000_000,
    speakers: null,
    state: "missing",
    installedAt: null,
    download: null,
    ...overrides,
  };
}

describe("describeLocalModelState", () => {
  it("words each state for a person, with the size where it helps", () => {
    expect(describeLocalModelState(model({ state: "missing" }))).toMatchObject({
      label: "Not downloaded",
      tone: "muted",
      detail: "324 MB download",
    });
    expect(describeLocalModelState(model({ state: "installed" }))).toMatchObject({
      label: "Installed",
      tone: "ok",
      detail: "324 MB",
      fraction: null,
    });
  });

  it("shows bytes against the total while downloading, and the fraction for the bar", () => {
    const copy = describeLocalModelState(
      model({
        state: "downloading",
        download: { bytes: 85_000_000, total: 340_000_000, error: null, startedAt: "x", finishedAt: null },
      }),
    );
    // Explorer-style: truncated, one decimal under 100.
    expect(copy).toMatchObject({ label: "Downloading", tone: "live", detail: "81.0 MB of 324 MB" });
    expect(copy.fraction).toBeCloseTo(0.25);
  });

  it("has no bar when the server never said the total", () => {
    const copy = describeLocalModelState(
      model({
        state: "downloading",
        download: { bytes: 1_000, total: null, error: null, startedAt: "x", finishedAt: null },
      }),
    );
    expect(copy.detail).toBe("1000 bytes so far");
    expect(copy.fraction).toBeNull();
  });

  it("carries the failure message, with a fallback", () => {
    expect(
      describeLocalModelState(
        model({
          state: "failed",
          download: { bytes: 0, total: null, error: "download failed (503)", startedAt: "x", finishedAt: "y" },
        }),
      ),
    ).toMatchObject({ label: "Failed", tone: "danger", detail: "download failed (503)" });
    expect(describeLocalModelState(model({ state: "failed" })).detail).toBe("The download did not finish.");
  });
});
