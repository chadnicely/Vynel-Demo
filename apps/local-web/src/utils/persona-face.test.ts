import { describe, expect, it } from "vitest";
import type { ScopeCustomization } from "../stores/customize-store-codec.js";
import { personaFaceOf } from "./persona-face.js";

function custom(overrides: Partial<ScopeCustomization>): ScopeCustomization {
  return {
    colorSlot: null,
    customColor: null,
    personaColorSlot: null,
    personaCustomColor: null,
    personaImage: null,
    workspaceImage: null,
    groups: [],
    entries: [],
    ...overrides,
  } as ScopeCustomization;
}

// One logo, everywhere: a workspace that uploaded only its icon wears it as
// its persona's face too; a persona icon set on purpose still wins.
describe("personaFaceOf", () => {
  it("falls back from the persona icon to the workspace logo, then to nothing", () => {
    expect(personaFaceOf(custom({ personaImage: "data:p", workspaceImage: "data:w" }))).toBe("data:p");
    expect(personaFaceOf(custom({ workspaceImage: "data:w" }))).toBe("data:w");
    expect(personaFaceOf(custom({}))).toBeNull();
    expect(personaFaceOf(null)).toBeNull();
    expect(personaFaceOf(undefined)).toBeNull();
  });
});
