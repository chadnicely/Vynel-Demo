import { describe, expect, it } from "vitest";
import { figureTrend, trendPath } from "./demo-figure-trend.js";

describe("figureTrend", () => {
  it("gives one figure the same trend every time it is asked", () => {
    const first = figureTrend("Sales", "$1,508");
    const second = figureTrend("Sales", "$1,508");
    expect(second).toEqual(first);
  });

  it("gives different figures different trends", () => {
    const sales = figureTrend("Sales", "$1,508");
    const quiz = figureTrend("Quiz submissions", "530");
    expect(quiz.caption === sales.caption && quiz.points[0] === sales.points[0]).toBe(
      false,
    );
  });

  it("says which way it went, in words a viewer can read", () => {
    const trend = figureTrend("Open rate", "29%");
    expect(trend.caption).toMatch(/^(up|down) \d+% from yesterday$/);
    expect(["up", "down"]).toContain(trend.direction);
  });

  it("normalises the series so the sparkline always fills its box", () => {
    const { points } = figureTrend("Replies", "47");
    expect(points).toHaveLength(7);
    expect(Math.min(...points)).toBeCloseTo(0);
    expect(Math.max(...points)).toBeCloseTo(1);
  });
});

describe("trendPath", () => {
  it("draws left to right with the top of the box as 1", () => {
    expect(trendPath([0, 1], 100, 20)).toBe("M0.0 20.0 L100.0 0.0");
  });

  it("draws nothing for an empty series", () => {
    expect(trendPath([], 100, 20)).toBe("");
  });
});
