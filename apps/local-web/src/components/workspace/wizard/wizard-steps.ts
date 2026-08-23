// The 13-screen "Walk me through it" wizard's step machine — ids, the copy
// each screen opens with, and the per-step gate (what still stands between
// the user and Continue, said in words beside the button — never a silently
// dead control). Ported from Chad's design branch; the folder comes FIRST
// (Kafi, 2026-08-23): the user picks the folder that IS the workspace before
// anything else, and every AI read dispatches from that folder.

import type { WorkspaceBriefAnswers } from "@vynel/contracts/workspaces/workspace-brief";
import { ADVANCED_ROWS, chosenStack } from "./derive-stack.js";

export const WIZARD_STEPS = [
  "place",
  "idea",
  "q1",
  "q2",
  "rivals",
  "wants",
  "plan",
  "goals",
  "stack",
  "account",
  "care",
  "sessions",
  "done",
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number];

/** Numbered steps — the Done screen sits past the rail. */
export const WIZARD_LAST = WIZARD_STEPS.length - 1;

export type WizardWant = { text: string; from: string };

/** Everything the user answers, in one flat object the screens write into. */
export type WizardAnswers = {
  /** Screen 1 — the folder (absolute path) that IS the workspace. */
  directory: string | null;
  appName: string;
  idea: string;
  who: string | null;
  first: string;
  signin: string | null;
  where: string | null;
  remembers: string[];
  rivals: string[];
  /** The site being typed into the add box — the footer reads it to offer
   *  "Look into it" instead of Continue. */
  rivalDraft: string;
  wants: WizardWant[];
  /** Rating loop: the score they gave the plan, and every change they sent. */
  score: number | null;
  changes: string;
  changeRequests: string[];
  goalsOk: boolean;
  goalNotes: string[];
  stackPicks: Record<string, string>;
  advNotes: string;
  planApproved: boolean;
};

export function makeEmptyAnswers(): WizardAnswers {
  return {
    directory: null,
    appName: "",
    idea: "",
    who: null,
    first: "",
    signin: null,
    where: null,
    remembers: [],
    rivals: [],
    rivalDraft: "",
    wants: [],
    score: null,
    changes: "",
    changeRequests: [],
    goalsOk: false,
    goalNotes: [],
    stackPicks: {},
    advNotes: "",
    planApproved: false,
  };
}

export const WIZARD_COPY: Record<
  WizardStepId,
  { title: string; blurb: string }
> = {
  place: {
    title: "Give it a home and a name",
    blurb:
      "Pick the folder on this computer that will be the workspace — it stays there, nothing gets moved — and tell us what to call it.",
  },
  idea: {
    title: "What do you want to build?",
    blurb:
      "Describe it the way you'd describe it to a friend. No right words — we'll work the rest out together.",
  },
  q1: {
    title: "A few questions",
    blurb: "Three quick ones, so the app we build is the one you're picturing.",
  },
  q2: {
    title: "Almost there",
    blurb: "Two more, and then we can show you the plan.",
  },
  rivals: {
    title: "Is there one like it already?",
    blurb:
      "Give us a website that does something similar and we will pull it apart — what it does, what we would leave out, and what would make yours better than it.",
  },
  wants: {
    title: "Everything you liked, in one place",
    blurb:
      "These are the bits you ticked across the sites you looked at. Take any of them off, or add your own — this is the wish list we build from.",
  },
  plan: {
    title: "The whole plan",
    blurb:
      "Your idea, your answers and everything you ticked from the other sites — pulled into one plan, with what we are deliberately leaving out. Have a read, then tell us how close it is.",
  },
  goals: {
    title: "Your MVP",
    blurb:
      "MVP means the smallest version worth using — enough to be genuinely useful, and nothing more. Here it is in plain words, then as goals.",
  },
  stack: {
    title: "What we will build it with",
    blurb:
      "Three choices, already made for you. Have a glance and carry on — you only need to touch these if you have a preference.",
  },
  account: {
    title: "The account that builds",
    blurb:
      "Vynel builds with your own Claude account — the one signed in to this app. Nothing to pick here; just a quick check that it is ready.",
  },
  care: {
    title: "Security & Protection — Built In",
    blurb: "You focus on your software. We take care of the foundation.",
  },
  sessions: {
    title: "How we will build it",
    blurb:
      "The MVP broken into sessions — we work through them in order and show you each one on your computer as it lands. Open any session to see what is in it, then approve the lot in one go.",
  },
  done: {
    title: "What happens from here",
    blurb:
      "Setup is done. This is the road ahead — the MVP first, real people next, and only then the marketing.",
  },
};

/** What the gate needs that is not an answer — the global sign-in state. */
export type WizardGateContext = { isSignedIn: boolean };

/** What still stands between the user and Continue — null when nothing does. */
export function wizardGate(
  step: WizardStepId,
  answers: WizardAnswers,
  context: WizardGateContext,
): string | null {
  if (step === "place") {
    if (answers.directory === null)
      return "Pick the folder it will live in to continue";
    return answers.appName.trim().length > 0
      ? null
      : "Give it a name to continue";
  }
  if (step === "idea")
    return answers.idea.trim().length > 8
      ? null
      : "Tell us the idea to continue";
  if (step === "q1") {
    return answers.who !== null &&
      answers.first.trim().length > 3 &&
      answers.signin !== null
      ? null
      : "Answer all three to continue";
  }
  if (step === "q2") {
    return answers.where !== null && answers.remembers.length > 0
      ? null
      : "Answer both to continue";
  }
  if (step === "plan") {
    if (answers.score === 10) return null;
    if (answers.score === null) return "Score it out of 10 to continue";
    return answers.changes.trim().length > 3
      ? null
      : "Tell us what to change to continue";
  }
  if (step === "goals")
    return answers.goalsOk ? null : "Tell us if the MVP is right to continue";
  if (step === "account")
    return context.isSignedIn ? null : "Sign in to Claude to continue";
  if (step === "sessions")
    return answers.planApproved ? null : "Approve the plan to finish";
  return null;
}

/** The advanced-settings picks that differ from their defaults, as one
 *  plain line — "Language: JavaScript · Package manager: npm" — so a lit
 *  chip is never a choice that went nowhere. */
function advancedPicksLine(answers: WizardAnswers): string {
  return ADVANCED_ROWS.flatMap((row) => {
    const pick = answers.stackPicks[row.key];
    return pick !== undefined && pick !== row.fallback
      ? [`${row.role}: ${pick}`]
      : [];
  }).join(" · ");
}

/** The answers as the engine reads them — the synthesis request and the
 *  stored brief are the SAME object, so what the user rated is what is
 *  kept. Unanswered choices fall to the plan's own defaults; the advanced
 *  picks and the free notes ride together as `advancedNotes`. */
export function toBriefAnswers(
  answers: WizardAnswers,
  leftOut: string[],
): WorkspaceBriefAnswers {
  const advancedNotes = [advancedPicksLine(answers), answers.advNotes.trim()]
    .filter((part) => part.length > 0)
    .join("; ");
  return {
    idea: answers.idea,
    audience: answers.who ?? "your people",
    firstThing: answers.first,
    signIn: answers.signin ?? "No, open to everyone",
    where: answers.where ?? "A website",
    remembers: [...answers.remembers],
    wants: answers.wants.map((want) => ({ ...want })),
    leftOut: [...leftOut],
    changeRequests: [...answers.changeRequests],
    goalNotes: [...answers.goalNotes],
    stack: chosenStack(answers),
    ...(advancedNotes.length > 0 ? { advancedNotes } : {}),
  };
}
