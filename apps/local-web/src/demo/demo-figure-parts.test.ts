import { describe, expect, it } from "vitest";
import { figureParts, figureTone, formatFigure } from "./demo-figure-parts.js";

describe("figureParts", () => {
  it("keeps the currency and rolls the amount", () => {
    expect(figureParts("$1,508")).toMatchObject({
      prefix: "$",
      amount: 1508,
      suffix: "",
      decimals: 0,
      grouped: true,
    });
  });

  it("keeps the percent sign", () => {
    expect(figureParts("29%")).toMatchObject({ prefix: "", amount: 29, suffix: "%" });
  });

  it("keeps a unit and its decimals", () => {
    expect(figureParts("3.2k")).toMatchObject({
      amount: 3.2,
      suffix: "k",
      decimals: 1,
    });
  });

  it("refuses a figure with no number in it", () => {
    expect(figureParts("all done")).toBeNull();
  });
});

describe("formatFigure", () => {
  it("writes each frame the way the finished figure is written", () => {
    const parts = figureParts("$1,508")!;
    expect(formatFigure(parts, 742)).toBe("$742");
    expect(formatFigure(parts, 1508)).toBe("$1,508");
  });

  it("holds the decimals steady on the way up", () => {
    const parts = figureParts("3.2k")!;
    expect(formatFigure(parts, 1.234)).toBe("1.2k");
  });
});

describe("figureTone", () => {
  it("reads money, rates and plain counts apart", () => {
    expect(figureTone("$1,508")).toBe("money");
    expect(figureTone("29%")).toBe("rate");
    expect(figureTone("530")).toBe("count");
  });
});
