// Screen 9's stack — the three choices, already made, each with the plain
// reason it was chosen, derived mechanically from the answers (real logic,
// nothing pretend). Ported faithfully from the design branch.

import type { WorkspaceStack } from "@vynel/contracts/workspaces/workspace-brief";
import type { WizardAnswers } from "./wizard-steps.js";

export type StackRow = {
  key: "framework" | "backend" | "db";
  role: string;
  what: string;
  value: string;
  note: string;
  options: string[];
};

const NOTES: Record<string, string> = {
  "Next.js":
    "A well-worn choice for apps like this — easy to find help for later.",
  "Nuxt.js":
    "Loads fast and shows up well in Google — good for a site people find.",
  "Expo (React Native)": "One app that works on both iPhone and Android.",
  SQLite: "Kept in one tidy file on your computer. Simplest thing that works.",
  Postgres: "Copes with lots of records and lots of people at once.",
  MongoDB: "Relaxed about shape — good when every record is a bit different.",
  "Node + Express":
    "A plain, steady engine — the most widely understood option.",
  "Nitro (built into Nuxt)":
    "Comes with the front end, so there is one less thing to run.",
  "Next.js API routes":
    "Comes with the front end, so there is one less thing to run.",
};

export function deriveStackRows(answers: WizardAnswers): StackRow[] {
  const phone = answers.where === "A phone app";
  const both = answers.where === "Both";
  const publicSite =
    answers.who === "Anyone on the internet" || answers.who === "My customers";
  const framework = phone
    ? "Expo (React Native)"
    : publicSite && !answers.remembers.includes("Products")
      ? "Nuxt.js"
      : "Next.js";
  // The back end pairs with the front end the user is ACTUALLY getting —
  // an override on the framework must carry its matching engine.
  const chosenFramework = answers.stackPicks["framework"] ?? framework;
  const backend =
    chosenFramework === "Nuxt.js"
      ? "Nitro (built into Nuxt)"
      : chosenFramework === "Next.js"
        ? "Next.js API routes"
        : "Node + Express";
  const database = answers.remembers.length > 2 ? "Postgres" : "SQLite";

  const rows: StackRow[] = [
    {
      key: "framework",
      role: "Front end",
      what: "The part people see and touch",
      value: framework,
      note: "",
      options: both
        ? ["Next.js", "Nuxt.js", "Expo (React Native)"]
        : phone
          ? ["Expo (React Native)", "Next.js"]
          : ["Next.js", "Nuxt.js"],
    },
    {
      key: "backend",
      role: "Back end",
      what: "The work happening behind it",
      value: backend,
      note: "",
      options: [
        "Next.js API routes",
        "Nitro (built into Nuxt)",
        "Node + Express",
      ],
    },
    {
      key: "db",
      role: "Database",
      what: "Where everything is kept",
      value: database,
      note: "",
      options: ["SQLite", "Postgres", "MongoDB"],
    },
  ];
  return rows.map((row) => {
    const chosen = answers.stackPicks[row.key] ?? row.value;
    return { ...row, value: chosen, note: NOTES[chosen] ?? "" };
  });
}

/** The user's effective picks, for the README + the brief. */
export function chosenStack(answers: WizardAnswers): WorkspaceStack {
  const rows = deriveStackRows(answers);
  return {
    front: rows[0]?.value ?? "Next.js",
    back: rows[1]?.value ?? "Next.js API routes",
    database: rows[2]?.value ?? "SQLite",
  };
}

export type AdvancedRow = {
  key: string;
  role: string;
  options: string[];
  fallback: string;
};

export const ADVANCED_ROWS: AdvancedRow[] = [
  {
    key: "lang",
    role: "Language",
    options: ["TypeScript", "JavaScript"],
    fallback: "TypeScript",
  },
  {
    key: "pkg",
    role: "Package manager",
    options: ["pnpm", "npm", "bun"],
    fallback: "pnpm",
  },
  {
    key: "data",
    role: "Data access",
    options: ["Prisma", "Drizzle", "Raw SQL", "Mongoose"],
    fallback: "Prisma",
  },
  {
    key: "style",
    role: "Styling",
    options: ["Tailwind CSS", "CSS Modules", "Plain CSS"],
    fallback: "Tailwind CSS",
  },
  {
    key: "test",
    role: "Tests",
    options: ["Vitest", "Playwright", "None for now"],
    fallback: "Vitest",
  },
];
