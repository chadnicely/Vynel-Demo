import { describe, expect, it } from "vitest";
import { parseComposerTokens } from "@vynel/contracts/chat/composer-tokens";
import {
  buildMentionSuggestions,
  buildSlashSuggestions,
  buildWorkspaceSuggestions,
  selectOtherWorkspaces,
} from "./composer-suggestion-rosters.js";

const workspaces = [
  { id: "w1", name: "Acme", managerName: "Sarah", isArchived: false },
  { id: "w2", name: "Q3 plans", managerName: null, isArchived: false },
  { id: "w3", name: "Old", managerName: "Mark", isArchived: true },
];

describe("selectOtherWorkspaces", () => {
  it("drops archived rows and the current workspace", () => {
    expect(selectOtherWorkspaces(workspaces, "w1").map((w) => w.id)).toEqual(["w2"]);
    expect(selectOtherWorkspaces(workspaces, null).map((w) => w.id)).toEqual(["w1", "w2"]);
  });
});

describe("buildMentionSuggestions", () => {
  it("lists agents then personas; a default persona IS the workspace name, offered only when it @-parses", () => {
    const items = buildMentionSuggestions(
      [{ id: "a1", slug: "code-reviewer", name: "Code Reviewer" }],
      selectOtherWorkspaces(workspaces, null),
    );
    expect(items[0]).toMatchObject({
      group: "Agents",
      label: "Code Reviewer",
      insert: "@code-reviewer",
    });
    expect(items[1]).toMatchObject({ group: "People", insert: "@Sarah" });
    // w2's default persona is "Q3 plans" — a name with a space can't be an
    // @-token, so the roster honestly leaves it out rather than offer a dud.
    expect(items).toHaveLength(2);
  });

  it("every offered insert parses back to the EXACT stored name (the server's match)", () => {
    const items = buildMentionSuggestions(
      [{ id: "a1", slug: "helper", name: "Helper" }],
      selectOtherWorkspaces(workspaces, null),
    );
    const storedNames = ["helper", "Sarah"];
    expect(items).toHaveLength(2);
    items.forEach((item, index) => {
      const parsed = parseComposerTokens(item.insert).mentions;
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.name).toBe(storedNames[index]);
    });
  });

  it("drops a persona whose renamed manager cannot round-trip (@Mary Jane would silently no-op)", () => {
    const items = buildMentionSuggestions(
      [],
      [
        { id: "wa", name: "Alpha", managerName: "Mary Jane", isArchived: false },
        { id: "wb", name: "Beta", managerName: "Mary-Jane", isArchived: false },
      ],
    );
    // "Mary Jane" parses as mention "Mary" ≠ the stored name → never offered;
    // the hyphenated rename round-trips and stays.
    expect(items.map((item) => item.insert)).toEqual(["@Mary-Jane"]);
  });
});

describe("buildWorkspaceSuggestions", () => {
  it("auto-quotes names the simple form cannot carry — parsed name === stored name", () => {
    const rows = selectOtherWorkspaces(workspaces, null);
    const items = buildWorkspaceSuggestions(rows);
    expect(items.map((item) => item.insert)).toEqual(["#Acme", '#"Q3 plans"']);
    items.forEach((item, index) => {
      const parsed = parseComposerTokens(item.insert).workspaceRefs;
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.name).toBe(rows[index]!.name);
    });
  });

  it("drops a workspace whose name cannot round-trip (embedded quotes / newlines)", () => {
    const items = buildWorkspaceSuggestions([
      { id: "wq", name: 'my "cool" app', managerName: null, isArchived: false },
      { id: "wn", name: "two\nlines", managerName: null, isArchived: false },
      { id: "wk", name: "Keeps", managerName: null, isArchived: false },
    ]);
    // A quoted token can't carry `"` (the stripped form parses to a DIFFERENT
    // name) and the grammar never spans newlines — both are dead tokens the
    // picker must not offer.
    expect(items.map((item) => item.insert)).toEqual(["#Keeps"]);
  });
});

describe("buildSlashSuggestions", () => {
  it("commands insert slash-verbatim; skills insert the instruction form; unhealthy skills drop", () => {
    const items = buildSlashSuggestions(
      [{ commandName: "git:commit", description: "Commit", scope: "user" }],
      [
        {
          id: "s1",
          skillId: "pdf",
          installHealth: "healthy",
          definition: { displayName: "PDF toolkit" },
        },
        { id: "s2", skillId: "gone", installHealth: "missing-on-disk", definition: null },
      ],
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ group: "Commands", insert: "/git:commit" });
    expect(parseComposerTokens(items[0]!.insert).slashCommand?.command).toBe("git:commit");
    expect(items[1]).toMatchObject({
      group: "Skills",
      label: "PDF toolkit",
      insert: "Use the pdf skill: ",
    });
  });
});
