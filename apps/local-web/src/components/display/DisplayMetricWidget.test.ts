// One number and how loudly it reads.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import {
  DISPLAY_METRIC_TONES,
  type MetricWidgetContent,
} from "@vynel/contracts/display/display-widget-content";
import DisplayMetricWidget from "./DisplayMetricWidget.vue";

function mountMetric(content: Omit<MetricWidgetContent, "kind">) {
  return mount(DisplayMetricWidget, {
    props: { content: { kind: "metric", ...content } },
  });
}

describe("DisplayMetricWidget", () => {
  it("shows the value, the label and the delta", () => {
    const wrapper = mountMetric({ value: "12", label: "Runs today", delta: "+3" });

    expect(wrapper.find(".value").text()).toBe("12");
    expect(wrapper.find(".label").text()).toBe("Runs today");
    expect(wrapper.get('[data-testid="display-metric-delta"]').text()).toBe("+3");
  });

  it("drops the delta line when there is none", () => {
    const wrapper = mountMetric({ value: "12", label: "Runs today" });

    expect(wrapper.find('[data-testid="display-metric-delta"]').exists()).toBe(false);
  });

  it("carries every tone through as a class, defaulting to default", () => {
    for (const tone of DISPLAY_METRIC_TONES) {
      const wrapper = mountMetric({ value: "1", label: "x", tone });
      expect(wrapper.get('[data-testid="display-widget-metric"]').classes()).toContain(
        `is-${tone}`,
      );
    }

    const untoned = mountMetric({ value: "1", label: "x" });
    expect(untoned.get('[data-testid="display-widget-metric"]').classes()).toContain(
      "is-default",
    );
  });
});
