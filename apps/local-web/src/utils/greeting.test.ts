import { describe, expect, it } from "vitest";
import { firstNameOf, greetingForHour } from "./greeting.js";

describe("greetingForHour", () => {
  it("says good morning from 5:00 through 11:59", () => {
    expect(greetingForHour(5)).toBe("Good morning");
    expect(greetingForHour(11)).toBe("Good morning");
  });

  it("says good afternoon from 12:00 through 17:59", () => {
    expect(greetingForHour(12)).toBe("Good afternoon");
    expect(greetingForHour(17)).toBe("Good afternoon");
  });

  it("says good evening at night", () => {
    expect(greetingForHour(18)).toBe("Good evening");
    expect(greetingForHour(23)).toBe("Good evening");
  });

  it("notices the small hours", () => {
    expect(greetingForHour(0)).toBe("Up late");
    expect(greetingForHour(4)).toBe("Up late");
  });
});

describe("firstNameOf", () => {
  it("takes the first word of a display name", () => {
    expect(firstNameOf("Sam Lee")).toBe("Sam");
    expect(firstNameOf("  Chad ")).toBe("Chad");
  });

  it("returns null when there is no usable name", () => {
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf("   ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});
