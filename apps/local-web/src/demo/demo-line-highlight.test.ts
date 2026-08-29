import { describe, expect, it } from "vitest";
import { highlightLine } from "./demo-line-highlight.js";

// The board row a spoken line becomes. Wrong extractions put a nonsense pair on
// camera, so the rules are pinned line-shape by line-shape.

describe("highlightLine", () => {
  it("leads with money — the dollar figure IS the headline", () => {
    expect(highlightLine("Sales came in at $2,300 tonight.")).toEqual({
      label: "Sales",
      value: "$2,300",
    });
  });

  it("reads percents", () => {
    expect(highlightLine("Open rate percent hit 48% this week.")).toEqual({
      label: "Open rate percent",
      value: "48%",
    });
  });

  it("reads the subject AFTER a leading figure — the quiz-submissions case", () => {
    // "225 quiz submissions…" labelled itself "Update" before, which on camera
    // looked like the board simply not changing (Chad, 2026-08-29).
    expect(highlightLine("225 quiz submissions came through overnight.")).toEqual({
      label: "Quiz submissions",
      value: "225",
    });
  });

  it("names the product when the line does", () => {
    expect(
      highlightLine("Quizforma pushed 312 new quizzes live.", ["Quizforma", "Letterman"]),
    ).toEqual({ label: "Quizforma", value: "312" });
  });

  it("stays quiet on a line with no figure — a greeting is not a stat", () => {
    expect(highlightLine("Good evening, welcome back.")).toBeNull();
  });

  it("clips a runaway label so the panel column keeps its shape", () => {
    const highlight = highlightLine(
      "Absolutely extraordinary unprecedented remarkable submissions hit 40 today.",
    );
    expect(highlight!.label.length).toBeLessThanOrEqual(22);
  });
});

describe("filler that is never a label", () => {
  it("reads the subject, not who did it — the WE BOOKED case", () => {
    // On camera this printed "WE BOOKED · $911", which says nothing about the
    // business (Chad, 2026-08-29).
    expect(highlightLine("We booked $911 in sales this evening.")).toEqual({
      label: "Sales",
      value: "$911",
    });
  });
});
