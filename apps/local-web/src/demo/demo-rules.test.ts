import { describe, expect, it } from "vitest";
import {
  applyMetricRules,
  DEFAULT_METRIC_RULES,
  displayMetric,
  formatMetric,
  formatMetricRules,
  metricRuleId,
  metricSlot,
  parseMetricRuleLines,
  parseMetricRules,
  rollMetric,
  rollTakeMetrics,
  type MetricRule,
} from "./demo-rules.js";

const sales: MetricRule = {
  id: "sales",
  label: "Sales",
  min: 400,
  max: 2300,
  money: true,
};
const leads: MetricRule = {
  id: "leads",
  label: "Leads",
  min: 375,
  max: 1200,
  money: false,
};

describe("rollMetric", () => {
  it("stays inside the range at both ends", () => {
    expect(rollMetric(sales, () => 0)).toBe(400);
    expect(rollMetric(sales, () => 0.999999)).toBe(2300);
  });

  it("never leaves the range across many rolls", () => {
    for (let i = 0; i < 200; i += 1) {
      const value = rollMetric(leads, Math.random);
      expect(value).toBeGreaterThanOrEqual(375);
      expect(value).toBeLessThanOrEqual(1200);
    }
  });

  it("survives a range typed backwards rather than rolling NaN", () => {
    const backwards = { ...leads, min: 900, max: 100 };
    const value = rollMetric(backwards, () => 0.5);
    expect(value).toBeGreaterThanOrEqual(100);
    expect(value).toBeLessThanOrEqual(900);
  });
});

describe("formatMetric", () => {
  it("groups digits, and marks money with a dollar sign", () => {
    expect(formatMetric(sales, 1450)).toBe("$1,450");
    expect(formatMetric(leads, 1200)).toBe("1,200");
  });
});

describe("applyMetricRules", () => {
  it("fills a slot with the take's number for that rule", () => {
    const take = rollTakeMetrics([sales], () => 0);
    expect(applyMetricRules("Sales came in at {sales}.", take)).toBe(
      "Sales came in at $400.",
    );
  });

  it("speaks ONE figure per metric for the whole take — never contradicts itself", () => {
    // A random that would give a different number on every call: the take
    // still says the same figure in both sentences.
    let call = 0;
    const drifting = () => (call++ % 2 === 0 ? 0 : 0.999999);
    const take = rollTakeMetrics([sales, leads], drifting);
    const first = applyMetricRules("Sales are {sales}.", take);
    const second = applyMetricRules("Still {sales} in sales.", take);
    expect(second).toContain(first.replace("Sales are ", "").replace(".", ""));
  });

  it("leaves an unknown slot visible rather than blanking the sentence", () => {
    const take = rollTakeMetrics([sales], () => 0);
    expect(applyMetricRules("{webinars} seats", take)).toBe("{webinars} seats");
  });

  it("leaves a line with no slots untouched", () => {
    const take = rollTakeMetrics([sales, leads], () => 0);
    expect(applyMetricRules("Mintbird is stable.", take)).toBe("Mintbird is stable.");
  });
});

describe("the typed rule format", () => {
  it("reads the shapes Chad actually types", () => {
    const rules = parseMetricRules(
      [
        "leads: 300-1200",
        "sales: $434 - 2340",
        "quiz submissions: up to 600",
        "members: 3 to 25",
        "revenue: $1,200-$8,400",
      ].join("\n"),
    );
    expect(rules.map((rule) => rule.id)).toEqual([
      "leads",
      "sales",
      "quiz-submissions",
      "members",
      "revenue",
    ]);
    expect(rules[0]).toMatchObject({ min: 300, max: 1200, money: false });
    expect(rules[1]).toMatchObject({ min: 434, max: 2340, money: true });
    // "up to 600" is a ceiling — the floor is a sensible fraction, never zero.
    expect(rules[2]!.max).toBe(600);
    expect(rules[2]!.min).toBeGreaterThan(0);
    expect(rules[3]).toMatchObject({ min: 3, max: 25 });
    // Commas in money survive the parse.
    expect(rules[4]).toMatchObject({ min: 1200, max: 8400, money: true });
  });

  it("reads percent signs rather than dropping the line", () => {
    const rules = parseMetricRules("open rate: 22%-48%");
    expect(rules[0]).toMatchObject({ min: 22, max: 48, percent: true });
  });

  it("a percent rule shows its sign but never SPEAKS it", () => {
    const rule = parseMetricRules("open rate: 22%-48%")[0]!;
    // The screen shows "43%"; the take says "43", because the update line
    // owns the word ("holding at {open-rate} percent").
    expect(displayMetric(rule, 43)).toBe("43%");
    expect(formatMetric(rule, 43)).toBe("43");
  });

  it("reports a line it cannot read instead of silently skipping it", () => {
    const { rules, unreadable } = parseMetricRuleLines(
      "leads: 300-1200\nkeep sales reasonable\n\nsales: 5-9",
    );
    expect(rules.map((rule) => rule.id)).toEqual(["leads", "sales"]);
    expect(unreadable).toEqual(["keep sales reasonable"]);
  });

  it("keeps a one-sided ceiling wide, so takes are not all the same number", () => {
    const rule = parseMetricRules("quiz submissions: not over 600")[0]!;
    expect(rule.max).toBe(600);
    expect(rule.min).toBe(60);
  });

  it("refuses a duplicate slot", () => {
    expect(parseMetricRules("leads: 1-2\nLeads: 5-9")).toHaveLength(1);
  });

  it("round-trips through the text box unchanged", () => {
    const typed = "Leads: 300-1,200\nSales: $434-$2,340";
    expect(formatMetricRules(parseMetricRules(typed))).toBe(typed);
  });
});

describe("the shipped rules", () => {
  it("cover the numbers Chad named, at his ranges", () => {
    const byId = new Map(DEFAULT_METRIC_RULES.map((rule) => [rule.id, rule]));
    expect(byId.get("sales")).toMatchObject({ min: 400, max: 2300, money: true });
    expect(byId.get("leads")).toMatchObject({ min: 375, max: 1200, money: false });
    expect(byId.has("quiz-submissions")).toBe(true);
  });

  it("slugs a typed label into its slot", () => {
    expect(metricRuleId("Webinar Seats")).toBe("webinar-seats");
    expect(metricSlot({ ...sales, id: "webinar-seats" })).toBe("{webinar-seats}");
  });
});
