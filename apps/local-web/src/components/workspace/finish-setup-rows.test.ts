import { describe, it, expect } from "vitest";
import { buildSetupRows, type ProjectSetup } from "./finish-setup-rows.js";

function setup(overrides: Partial<ProjectSetup> = {}): ProjectSetup {
  return {
    path: "C:\\dev\\shop",
    git: { kind: "repository", remoteUrl: null, branch: "main" },
    repository: { kind: "local-only", suggestedName: "shop" },
    env: { kind: "not-needed" },
    database: null,
    databaseIsLocal: false,
    needsAccountChoice: true,
    ...overrides,
  } as ProjectSetup;
}

describe("buildSetupRows", () => {
  it("names the four rows in order — repository, account, env, database", () => {
    const rows = buildSetupRows(setup(), "Claude — sam@x.dev");
    expect(rows.map((row) => row.id)).toEqual(["repository", "account", "env", "database"]);
    expect(rows.map((row) => row.title)).toEqual([
      "Git Repository",
      "AI Platform",
      "ENV File",
      "The database it already has",
    ]);
  });

  it("reads the repository three ways", () => {
    expect(
      buildSetupRows(setup({ repository: { kind: "remote", url: "git@x/y.git" } }), null)[0]!.value,
    ).toContain("already pushing here");
    expect(
      buildSetupRows(setup({ repository: { kind: "local-only", suggestedName: "shop" } }), null)[0]!
        .value,
    ).toContain("we would create this remote");
    expect(
      buildSetupRows(setup({ repository: { kind: "none", suggestedName: "shop" } }), null)[0]!.value,
    ).toContain("new private repository");
  });

  it("shows the builder account, or flags that none is connected", () => {
    const connected = buildSetupRows(setup(), "Claude — sam@x.dev")[1]!;
    expect(connected.value).toBe("Claude — sam@x.dev");
    expect(connected.needsAccount).toBeUndefined();

    const none = buildSetupRows(setup(), null)[1]!;
    expect(none.value).toBe("No account connected yet");
    expect(none.needsAccount).toBe(true);
  });

  it("carries env KEY NAMES with a count, never values", () => {
    const present = buildSetupRows(
      setup({ env: { kind: "present", keyNames: ["DATABASE_URL", "API_KEY"] } }),
      null,
    )[2]!;
    expect(present.value).toBe("already in the folder — 2 settings");
    expect(present.keyNames).toEqual(["DATABASE_URL", "API_KEY"]);

    const example = buildSetupRows(
      setup({ env: { kind: "from-example", keyNames: ["ONE"] } }),
      null,
    )[2]!;
    expect(example.value).toBe("we would build one from .env.example — 1 setting");
  });

  it("reads the database as local or remote, or says none is named", () => {
    expect(buildSetupRows(setup({ database: null }), null)[3]!.value).toBe(
      "nothing in the folder names one",
    );
    expect(
      buildSetupRows(setup({ database: "SQLite", databaseIsLocal: true }), null)[3]!.value,
    ).toContain("a file inside the project");
    expect(
      buildSetupRows(setup({ database: "Postgres", databaseIsLocal: false }), null)[3]!.value,
    ).toContain("on a server somewhere");
  });
});
