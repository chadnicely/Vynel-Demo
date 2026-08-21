import { describe, expect, it } from "vitest";
import type { DisplayWidgetView } from "@vynel/contracts/display/display-widget";
import type { DisplayWidgetContent } from "@vynel/contracts/display/display-widget-content";
import { displayDockCards } from "./display-dock-cards.js";

function widget(id: string, content: DisplayWidgetContent): DisplayWidgetView {
  return {
    id,
    scopeKey: "global",
    title: `${id} title`,
    kind: content.kind,
    content,
    slot: "dock",
    size: "sm",
    sortOrder: 1,
    createdBySessionId: null,
    expiresAt: null,
    createdAt: "2026-08-21T09:00:00.000Z",
    updatedAt: "2026-08-21T09:00:00.000Z",
  };
}

describe("displayDockCards", () => {
  it("keeps a metric's number and its label", () => {
    expect(
      displayDockCards([
        widget("w1", { kind: "metric", value: "12", label: "Runs", delta: "+2" }),
      ]),
    ).toEqual([{ id: "w1", shape: "metric", value: "12", label: "Runs" }]);
  });

  it("shows a one-line markdown card as that line", () => {
    expect(
      displayDockCards([widget("w2", { kind: "markdown", body: "  Build is green  " })]),
    ).toEqual([{ id: "w2", shape: "line", text: "Build is green" }]);
  });

  // Unreadable in one row — but named, so the user knows it is on the board.
  it("names everything a corner cannot render", () => {
    expect(
      displayDockCards([
        widget("w3", { kind: "markdown", body: "First line\nSecond line" }),
        widget("w4", { kind: "table", columns: ["a"], rows: [["1"]] }),
        widget("w5", {
          kind: "chart",
          type: "bar",
          series: [{ name: "s", points: [{ label: "p", value: 1 }] }],
        }),
      ]),
    ).toEqual([
      { id: "w3", shape: "chip", title: "w3 title" },
      { id: "w4", shape: "chip", title: "w4 title" },
      { id: "w5", shape: "chip", title: "w5 title" },
    ]);
  });

  it("keeps the board's order", () => {
    const cards = displayDockCards([
      widget("w1", { kind: "table", columns: ["a"], rows: [] }),
      widget("w2", { kind: "metric", value: "3", label: "Open" }),
    ]);
    expect(cards.map((card) => card.id)).toEqual(["w1", "w2"]);
  });
});
