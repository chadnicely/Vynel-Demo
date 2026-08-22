// The wizard's mechanical plan — the same shape the AI synthesis returns,
// derived from the answers alone. This is the FALLBACK (and the instant
// content while a synthesis is in flight): honest because every line comes
// straight from what the user said, never invented. Ported faithfully from
// the design branch; "the repository" lines became "history" — the folder
// exists before session 1 and GitHub is not part of v1.

import type { WorkspacePlan } from "@vynel/contracts/workspaces/workspace-brief";
import type { WizardAnswers } from "./wizard-steps.js";

const AUDIENCE_WORDS: Record<string, string> = {
  "Just me": "you",
  "My team": "your team",
  "My customers": "your customers",
  "Anyone on the internet": "anyone who finds it",
};

function audienceWord(answers: WizardAnswers): string {
  return AUDIENCE_WORDS[answers.who ?? ""] ?? "your people";
}

function whereWord(answers: WizardAnswers): string {
  if (answers.where === "A phone app") return "a phone app";
  if (answers.where === "Both") return "a website and a phone app";
  return "a website";
}

function firstThing(answers: WizardAnswers): string {
  return (answers.first.trim() || "do the main thing").replace(/\.$/, "");
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function deriveFallbackPlan(
  answers: WizardAnswers,
  leftOut: string[],
): WorkspacePlan {
  const has = (entry: string) => answers.remembers.includes(entry);
  const first = firstThing(answers);

  const own: string[] = [`Let people ${lowerFirst(first)}`];
  if (answers.signin === "Yes, their own account")
    own.push("Let people make an account and come back to it");
  if (answers.signin === "One shared password")
    own.push("Keep it behind one shared password");
  if (has("Bookings")) own.push("Show what is booked, day by day");
  if (has("Products")) own.push("Show off what you sell, one piece at a time");
  if (has("Payments")) own.push("Take payment and send a receipt");
  if (has("Messages")) own.push("Let you and them talk in one place");
  if (has("Photos")) own.push("Hold photos next to whatever they belong to");
  own.push("Give you one quiet place to see all of it");

  const build = own
    .map((text) => ({ text, source: "your answers" }))
    .concat(
      answers.wants.map((want) => ({
        text: want.text,
        source: want.from === "you" ? "you added" : want.from,
      })),
    );

  const remembers = answers.remembers.length
    ? answers.remembers.slice()
    : ["Whatever people enter"];
  if (
    answers.signin !== "No, open to everyone" &&
    !remembers.includes("People")
  ) {
    remembers.unshift("People and how they sign in");
  }

  const borrowed = answers.wants
    .filter((want) => want.from !== "you")
    .map((want) => want.text);
  const added = answers.wants
    .filter((want) => want.from === "you")
    .map((want) => want.text);

  const goals: WorkspacePlan["goals"] = [
    {
      title: `Somewhere your people can ${lowerFirst(first)}`,
      bullets: [
        "One screen, start to finish — no signing up first",
        answers.signin === "No, open to everyone"
          ? "Anyone with the link can use it"
          : answers.signin === "One shared password"
            ? "One shared password keeps it private"
            : "Their own account, remembered next time",
        "Works the same on a phone",
      ],
    },
    {
      title: "Everything it needs to remember, kept safely",
      bullets: remembers
        .map((entry) => `A place for ${entry.toLowerCase()}`)
        .concat(["Every change recorded in history as we go"]),
    },
  ];
  if (own.length > 2)
    goals.push({
      title: "The rest of what you asked for",
      bullets: own.slice(1, -1),
    });
  if (borrowed.length || added.length) {
    goals.push({
      title: "The bits you liked on other sites",
      bullets: borrowed.concat(added),
    });
  }
  goals.push({
    title: "Yours to run, without needing us",
    bullets: [
      "One quiet page showing everything at a glance",
      "Ask for changes in plain words, any time",
    ],
  });

  const extras = build.filter(
    (entry) => entry.source !== "your answers",
  ).length;
  const mvpNutshell =
    `The MVP is ${whereWord(answers)} where ${audienceWord(answers)} can ${lowerFirst(first)}` +
    ` — that one job, done properly, on a phone or a laptop. It keeps track of ` +
    `${answers.remembers.length ? answers.remembers.join(", ").toLowerCase() : "what people enter"}, ` +
    `and gives you one page to see all of it.` +
    (extras
      ? ` It also includes the ${extras} ${extras === 1 ? "thing" : "things"} you liked on other sites.`
      : "") +
    ` Nothing you ticked has been dropped — it is all here.`;

  return {
    oneLine: `${whereWord(answers).charAt(0).toUpperCase()}${whereWord(answers).slice(1)} where ${audienceWord(answers)} can ${lowerFirst(first)}.`,
    build,
    remembers: remembers.slice(0, 6),
    leftOut: leftOut.slice(0, 6),
    mvpNutshell,
    goals,
    sessions: deriveSessions(answers, goals),
  };
}

function deriveSessions(
  answers: WizardAnswers,
  goals: WorkspacePlan["goals"],
): WorkspacePlan["sessions"] {
  const has = (entry: string) => answers.remembers.includes(entry);
  const first = firstThing(answers);
  const record = has("Bookings")
    ? "booking"
    : has("Products")
      ? "product"
      : "record";

  const raw: { name: string; items: string[] }[] = [
    {
      name: "Set the project up",
      items: [
        "The project skeleton in its folder",
        "A first commit, so nothing is ever lost",
      ],
    },
    {
      name: "Put the skeleton up",
      items: [
        "A page that loads on your computer",
        "The address you visit while we work",
      ],
    },
    {
      name: "Decide the look",
      items: ["Colours, type and spacing", "Looks right on a phone as well"],
    },
    {
      name: "The frame around every page",
      items: [
        "A header with the name",
        "A way to get from one place to another",
      ],
    },
    {
      name: "The front page",
      items: ["What people see the moment they arrive"],
    },
    {
      name: "Somewhere to keep things",
      items: [
        `Set up ${answers.remembers.length > 2 ? "Postgres" : "SQLite"}`,
        "A place for each kind of record",
      ],
    },
    answers.signin === "No, open to everyone"
      ? {
          name: "Let people in",
          items: ["No sign-in needed — anyone with the link can use it"],
        }
      : {
          name: "Signing in",
          items: [
            answers.signin === "One shared password"
              ? "One shared password"
              : "Their own account, with a way back in if they forget",
          ],
        },
    {
      name: "The main thing it does",
      items: [`Let people ${lowerFirst(first)}`],
    },
    {
      name: "Saving what people enter",
      items: [
        "Check it makes sense before saving",
        "Tell them clearly when something is wrong",
      ],
    },
    {
      name: "Seeing it all in a list",
      items: ["A list of everything, newest first", "Search and filter"],
    },
    {
      name: "Looking at one of them",
      items: [`A page for a single ${record}`, "Edit it, or remove it"],
    },
    has("Bookings")
      ? {
          name: "The calendar",
          items: [
            "See what is booked, day by day",
            "Stop two people booking the same slot",
          ],
        }
      : has("Products")
        ? {
            name: "Browsing what you sell",
            items: ["A tidy grid of everything", "Sort by price or newest"],
          }
        : {
            name: "Getting around quickly",
            items: ["Shortcuts to the things used most"],
          },
    has("Payments")
      ? {
          name: "Taking payment",
          items: ["Card payment at the end", "A receipt by email"],
        }
      : has("Messages")
        ? { name: "Messages", items: ["You and them, in one thread"] }
        : {
            name: "Keeping people posted",
            items: ["A short email when something changes"],
          },
    has("Photos")
      ? {
          name: "Photos",
          items: [
            "Drag a photo in, it appears where it belongs",
            "Kept small so pages stay quick",
          ],
        }
      : {
          name: "Your own quiet page",
          items: ["Everything at a glance, just for you"],
        },
    (() => {
      const borrowed = goals.find((goal) =>
        goal.title.includes("liked on other sites"),
      );
      return borrowed
        ? { name: "The bits you liked elsewhere", items: borrowed.bullets }
        : {
            name: "Small touches",
            items: ["The little things that make it feel finished"],
          };
    })(),
    {
      name: "Check it over and hand it to you",
      items: [
        "Click through every part once",
        "Make sure every change is saved in history",
      ],
    },
  ];

  const afterMvp = new Set([
    "Keeping people posted",
    "Photos",
    "Your own quiet page",
    "The bits you liked elsewhere",
    "Small touches",
  ]);
  return raw.map((session) => ({
    ...session,
    mvp: !afterMvp.has(session.name),
  }));
}
