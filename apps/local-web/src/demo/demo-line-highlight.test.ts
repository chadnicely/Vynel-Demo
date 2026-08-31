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

  // On camera the label is read as a caption under the figure, so a
  // preposition there is nonsense: "$1,896 SINCE" (Chad, 2026-08-30).
  it("never hangs the headline on a preposition after the figure", () => {
    const found = highlightLine(
      "We booked $1,896 since this morning, and it's still climbing.",
    );
    expect(found).toEqual({ label: "Booked", value: "$1,896" });
  });

  it("still takes a subject that leads straight off the figure", () => {
    expect(highlightLine("530 quiz submissions came through overnight.")).toEqual({
      label: "Quiz submissions",
      value: "530",
    });
  });

  it("prefers a real subject before the figure over the verb", () => {
    expect(highlightLine("Sales came in at $1,508 across the board today.")).toEqual({
      label: "Sales",
      value: "$1,508",
    });
  });

  it("falls back to the verb only when neither side has a subject", () => {
    expect(highlightLine("We sold 42 of them over the weekend.")?.label).toBe(
      "Sold",
    );
  });

  it("sees through a contraction to the pronoun inside it", () => {
    // "We've" is "we" wearing an apostrophe; the bare pronoun was filtered
    // and the contraction was not, so WE'VE went on camera.
    expect(highlightLine("We've pulled 467 leads since Monday.")).toEqual({
      label: "Leads",
      value: "467",
    });
  });

  it("stops the subject at the verb rather than truncating", () => {
    // Keeping "joined" as a third word pushed the label past its 22 chars
    // and it rendered "Mastermind members jo…".
    const found = highlightLine("21 new mastermind members joined today.");
    expect(found).toEqual({ label: "Mastermind members", value: "21" });
    expect(found!.label).not.toContain("…");
  });

  it("reads every shipped report line into something a viewer can parse", () => {
    const shipped: ReadonlyArray<readonly [string, string]> = [
      ["Sales came in at $1,508 across the board today.", "Sales"],
      ["Email open rate is holding at 39 percent.", "Email open rate"],
      ["530 quiz submissions came through overnight.", "Quiz submissions"],
      ["766 new leads came in this week.", "Leads"],
      ["We booked $1,896 since this morning, and it's still climbing.", "Booked"],
    ];
    for (const [text, label] of shipped) {
      expect(highlightLine(text)?.label).toBe(label);
    }
  });

  it("gives a spoken percent its sign", () => {
    // "39" alone read as a number with its unit chopped off.
    expect(highlightLine("Email open rate is holding at 39 percent.")).toEqual({
      label: "Email open rate",
      value: "39%",
    });
  });

  it("leaves a real percent sign alone", () => {
    expect(highlightLine("Conversion sits at 4.5% today.")?.value).toBe("4.5%");
  });

  it("does not invent a unit for a plain count", () => {
    expect(highlightLine("766 new leads came in this week.")?.value).toBe("766");
  });
});
