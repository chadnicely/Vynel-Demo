import { describe, expect, it } from "vitest";
import { speakableText } from "./demo-speakable.js";

describe("speakableText", () => {
  it("turns money into the words a person says", () => {
    expect(speakableText("Sales came in at $1,896 across the board today.")).toBe(
      "Sales came in at 1,896 dollars across the board today.",
    );
  });

  it("handles two figures in one line", () => {
    expect(speakableText("We booked $911 and refunded $40.")).toBe(
      "We booked 911 dollars and refunded 40 dollars.",
    );
  });

  it("says dollar, singular, for one", () => {
    expect(speakableText("Every $1 counts.")).toBe("Every 1 dollar counts.");
  });

  it("leaves percents and plain numbers alone", () => {
    const line = "Email open rate is holding at 39 percent, 530 submissions.";
    expect(speakableText(line)).toBe(line);
  });

  it("leaves a line with no money untouched", () => {
    const line = "Everything's green — want your updates?";
    expect(speakableText(line)).toBe(line);
  });
});
