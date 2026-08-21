// Columns, rows, caption — and the cap that keeps a table readable.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { DISPLAY_TABLE_MAX_COLUMNS } from "@vynel/contracts/display/display-widget-content";
import type { TableWidgetContent } from "@vynel/contracts/display/display-widget-content";
import DisplayTableWidget from "./DisplayTableWidget.vue";

function mountTable(content: Omit<TableWidgetContent, "kind">) {
  return mount(DisplayTableWidget, { props: { content: { kind: "table", ...content } } });
}

describe("DisplayTableWidget", () => {
  it("renders the header, every row and the caption", () => {
    const wrapper = mountTable({
      columns: ["Run", "Status"],
      rows: [
        ["nightly", "green"],
        ["hourly", "red"],
      ],
      caption: "This week",
    });

    expect(wrapper.findAll("th").map((cell) => cell.text())).toEqual(["Run", "Status"]);
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.findAll("tbody td").map((cell) => cell.text())).toEqual([
      "nightly",
      "green",
      "hourly",
      "red",
    ]);
    expect(wrapper.find("caption").text()).toBe("This week");
  });

  it("has no caption element when the content carries none", () => {
    const wrapper = mountTable({ columns: ["Run"], rows: [["nightly"]] });

    expect(wrapper.find("caption").exists()).toBe(false);
  });

  it("caps at twelve columns and trims each row to what is drawn", () => {
    const columns = Array.from({ length: 15 }, (_, index) => `c${index}`);
    const wrapper = mountTable({
      columns,
      rows: [columns.map((_, index) => `v${index}`)],
    });

    expect(wrapper.findAll("th")).toHaveLength(DISPLAY_TABLE_MAX_COLUMNS);
    expect(wrapper.findAll("tbody td")).toHaveLength(DISPLAY_TABLE_MAX_COLUMNS);
    expect(wrapper.text()).not.toContain("v12");
  });

  it("renders cell text as text, never as markup", () => {
    const wrapper = mountTable({
      columns: ["Note"],
      rows: [["<script>window.stolen = 1</script>"]],
    });

    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find("tbody td").text()).toBe("<script>window.stolen = 1</script>");
  });
});
