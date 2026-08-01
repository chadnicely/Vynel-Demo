import { describe, it, expect } from "vitest";
import { CATALOG_ICON_NAMES } from "@vynel/contracts/marketplace/catalog-icons";
import { CATALOG_ICONS } from "./catalog-icons.js";

describe("CATALOG_ICONS", () => {
  it("covers exactly the contracts allowlist", () => {
    expect(Object.keys(CATALOG_ICONS).sort()).toEqual([...CATALOG_ICON_NAMES].sort());
  });

  it("every name resolves to a real lucide component (a bad import would be undefined)", () => {
    for (const name of CATALOG_ICON_NAMES) {
      expect(CATALOG_ICONS[name], `icon '${name}'`).toBeTruthy();
    }
  });
});
