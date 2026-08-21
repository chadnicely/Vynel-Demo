// The frame: the title, the kind callsign, the size class, the right renderer
// for each kind — and the × that asks the API to take the card off the board.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import { displayWidgetKeys } from "../../composables/display/display-widget-keys.js";
import DisplayChartWidget from "./DisplayChartWidget.vue";
import DisplayMarkdownWidget from "./DisplayMarkdownWidget.vue";
import DisplayMetricWidget from "./DisplayMetricWidget.vue";
import DisplayTableWidget from "./DisplayTableWidget.vue";
import DisplayWidget from "./DisplayWidget.vue";

function makeWidget(overrides: Partial<DisplayWidgetView> = {}): DisplayWidgetView {
  return {
    id: "w1",
    scopeKey: "global",
    title: "This week",
    kind: "markdown",
    content: { kind: "markdown", body: "all green" },
    slot: "stage",
    size: "md",
    sortOrder: 1,
    createdBySessionId: null,
    expiresAt: null,
    createdAt: "2026-08-21T09:00:00.000Z",
    updatedAt: "2026-08-21T09:00:00.000Z",
    ...overrides,
  };
}

function mountWidget(
  widget: DisplayWidgetView,
  removeWidget = vi.fn(async () => ({ ok: true })),
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  // The board this card is on, as the room would already have read it.
  queryClient.setQueryData(displayWidgetKeys.scope(widget.scopeKey), [widget]);
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = mount(DisplayWidget, {
    props: { widget },
    global: {
      plugins: [[VueQueryPlugin, { queryClient }]],
      provide: { [vynelClientKey as symbol]: { display: { removeWidget } } },
    },
  });
  const board = () =>
    queryClient.getQueryData<DisplayWidgetView[]>(
      displayWidgetKeys.scope(widget.scopeKey),
    );
  return { wrapper, removeWidget, board, invalidateQueries };
}

describe("DisplayWidget", () => {
  it("shows the title and the kind callsign", () => {
    const { wrapper } = mountWidget(makeWidget({ kind: "table", title: "Runs" }));

    expect(wrapper.find(".title").text()).toBe("Runs");
    expect(wrapper.find(".kind").text()).toBe("TBL");
  });

  it("turns the size into a class", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { wrapper } = mountWidget(makeWidget({ size }));
      expect(wrapper.get('[data-testid="display-widget"]').classes()).toContain(
        `is-${size}`,
      );
    }
  });

  it("renders each kind with its own renderer", () => {
    const markdown = mountWidget(makeWidget()).wrapper;
    expect(markdown.findComponent(DisplayMarkdownWidget).exists()).toBe(true);

    const table = mountWidget(
      makeWidget({
        kind: "table",
        content: { kind: "table", columns: ["a"], rows: [["1"]] },
      }),
    ).wrapper;
    expect(table.findComponent(DisplayTableWidget).exists()).toBe(true);
    expect(table.findComponent(DisplayMarkdownWidget).exists()).toBe(false);

    const metric = mountWidget(
      makeWidget({ kind: "metric", content: { kind: "metric", value: "12", label: "Runs" } }),
    ).wrapper;
    expect(metric.findComponent(DisplayMetricWidget).exists()).toBe(true);

    const chart = mountWidget(
      makeWidget({
        kind: "chart",
        content: {
          kind: "chart",
          type: "bar",
          series: [{ name: "Runs", points: [{ label: "mon", value: 2 }] }],
        },
      }),
    ).wrapper;
    expect(chart.findComponent(DisplayChartWidget).exists()).toBe(true);
  });

  // The card leaves on the CLICK, not on the live frame that follows: with the
  // socket down the POST still succeeds and nothing else would ever move it.
  it("asks the API to remove the widget when × is clicked, and takes it off the board", async () => {
    const { wrapper, removeWidget, board } = mountWidget(makeWidget({ id: "w9" }));

    await wrapper.get('[data-testid="display-widget-remove"]').trigger("click");
    await flushPromises();

    expect(removeWidget).toHaveBeenCalledWith("w9");
    expect(board()).toEqual([]);
  });

  it("marks the × and re-reads the board when the removal failed", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    const { wrapper, invalidateQueries } = mountWidget(makeWidget(), failing);

    await wrapper.get('[data-testid="display-widget-remove"]').trigger("click");
    await flushPromises();

    const button = wrapper.get('[data-testid="display-widget-remove"]');
    expect(button.classes()).toContain("failed");
    expect(button.attributes("title")).toContain("failed");
    // The card comes back from the server, not from a snapshot — the board
    // may have moved on for other reasons while the request was in flight.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["display-widgets"] });
  });
});
