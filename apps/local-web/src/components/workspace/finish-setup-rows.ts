import type { VynelClient } from "@vynel/sdk";

// "Finish setting up" reads the folder and shows what it found — the
// repository, the AI account, the .env (KEY NAMES only), the database (Chad,
// 2026-08-10: Vynel is standing in the folder, so it should not ask what it
// can see). Every row is a READ: nothing here is a control that changes the
// project, so Done is always ready. The one thing the folder cannot answer —
// which account builds — is a link out to the global account, not a
// per-project pick (accounts are global).

export type ProjectSetup = Awaited<
  ReturnType<VynelClient["workspaces"]["getSetup"]>
>;

export type SetupRow = {
  id: "repository" | "account" | "env" | "database";
  title: string;
  body: string;
  /** The answer, in one line. */
  value: string;
  /** ENV only — the key NAMES found (values are never read). */
  keyNames?: string[];
  /** The AI-account row when nothing is connected — the footer link shows. */
  needsAccount?: boolean;
};

const TITLES = {
  repository: "Git Repository",
  account: "AI Platform",
  env: "ENV File",
  database: "The database it already has",
} as const;

const BODIES = {
  repository:
    "Where this project keeps its history, so nothing is lost and any change can be undone. A project can have more than one — the app and the server, sometimes a mobile or desktop version too.",
  account:
    "Which of your connected accounts does the building. Accounts are connected once, up in the title bar, and every project builds with them.",
  env: "The private settings the project needs to run — database address, payment keys, that sort of thing. The file stays on this computer and is never committed.",
  database:
    "The address is in the .env; the data is on a server somewhere. That last part matters.",
} as const;

function repositoryValue(repository: ProjectSetup["repository"]): string {
  if (repository.kind === "remote") return `${repository.url} — already pushing here`;
  if (repository.kind === "local-only")
    return `${repository.suggestedName} — has git, we would create this remote`;
  return `${repository.suggestedName} — new private repository`;
}

function envRow(env: ProjectSetup["env"]): SetupRow {
  if (env.kind === "not-needed") {
    return { id: "env", title: TITLES.env, body: BODIES.env, value: "nothing in the folder names one" };
  }
  const count = env.keyNames.length;
  const settings = `${count} ${count === 1 ? "setting" : "settings"}`;
  const value =
    env.kind === "present"
      ? `already in the folder — ${settings}`
      : `we would build one from .env.example — ${settings}`;
  // Key NAMES only — we never read what is in them.
  return { id: "env", title: TITLES.env, body: BODIES.env, value, keyNames: env.keyNames };
}

/** Builds the four read-only rows. `builderLabel` names the signed-in account
 *  that would build (null = none connected). */
export function buildSetupRows(setup: ProjectSetup, builderLabel: string | null): SetupRow[] {
  return [
    {
      id: "repository",
      title: TITLES.repository,
      body: BODIES.repository,
      value: repositoryValue(setup.repository),
    },
    {
      id: "account",
      title: TITLES.account,
      body: BODIES.account,
      value: builderLabel ?? "No account connected yet",
      // Only present when there is nothing connected — the row's link shows on
      // its truthiness, and the test pins it absent when an account is set.
      ...(builderLabel === null ? { needsAccount: true } : {}),
    },
    envRow(setup.env),
    {
      id: "database",
      title: TITLES.database,
      body: BODIES.database,
      value:
        setup.database === null
          ? "nothing in the folder names one"
          : setup.databaseIsLocal
            ? `${setup.database} — a file inside the project`
            : `${setup.database} — on a server somewhere`,
    },
  ];
}
