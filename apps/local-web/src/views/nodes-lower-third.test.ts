import { describe, expect, it } from "vitest";
import { splitHeading } from "./nodes-lower-third.js";

describe("splitHeading", () => {
  const names = ["Letterman", "Nicely Community", "VideoGeyser"];

  it("lifts a product used as a heading out of the sentence", () => {
    expect(
      splitHeading("Letterman — the welcome email is in.", names),
    ).toEqual({ name: "Letterman", body: "the welcome email is in." });
  });

  it("takes a colon or a dash the same way", () => {
    expect(splitHeading("VideoGeyser: exports are live.", names).name).toBe(
      "VideoGeyser",
    );
    expect(splitHeading("VideoGeyser - exports are live.", names).name).toBe(
      "VideoGeyser",
    );
  });

  it("leaves a name that is the sentence's subject alone", () => {
    expect(splitHeading("Letterman is live tonight.", names)).toEqual({
      name: null,
      body: "Letterman is live tonight.",
    });
  });

  it("matches a multi-word product name", () => {
    expect(splitHeading("Nicely Community — the map shipped.", names).name).toBe(
      "Nicely Community",
    );
  });

  it("leaves a line about nothing it knows alone", () => {
    expect(splitHeading("Every build is green.", names)).toEqual({
      name: null,
      body: "Every build is green.",
    });
  });
});
