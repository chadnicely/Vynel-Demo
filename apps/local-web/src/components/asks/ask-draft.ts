import type {
  AskAnswers,
  AskQuestion,
} from "@vynel/contracts/asks/ask-questions";

// What a field holds WHILE the user types. A number stays a raw string until
// submit so a half-typed value never corrupts the draft; choice/yes-no start
// at null so "untouched" is distinguishable from a real answer.
export type AskFieldValue = string | string[] | boolean | null;
export type AskDraft = Record<string, AskFieldValue>;

export function emptyDraftFor(questions: readonly AskQuestion[]): AskDraft {
  const draft: AskDraft = {};
  for (const question of questions) {
    if (question.type === "multi-choice") draft[question.id] = [];
    else if (question.type === "choice" || question.type === "yes-no")
      draft[question.id] = null;
    else draft[question.id] = "";
  }
  return draft;
}

export function isQuestionAnswered(
  question: AskQuestion,
  value: AskFieldValue | undefined,
): boolean {
  switch (question.type) {
    case "text":
      return typeof value === "string" && value.trim().length > 0;
    case "number":
      return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        Number.isFinite(Number(value))
      );
    case "choice":
      return typeof value === "string" && value.length > 0;
    case "multi-choice":
      return Array.isArray(value) && value.length > 0;
    case "yes-no":
      return typeof value === "boolean";
  }
}

// Only answered questions travel — an untouched optional question is absent
// from the payload, never an empty string/array the server would reject.
export function buildAnswers(
  questions: readonly AskQuestion[],
  draft: AskDraft,
): AskAnswers {
  const answers: AskAnswers = {};
  for (const question of questions) {
    const value = draft[question.id];
    if (!isQuestionAnswered(question, value)) continue;
    if (question.type === "text") answers[question.id] = (value as string).trim();
    else if (question.type === "number")
      answers[question.id] = Number(value as string);
    else if (question.type === "multi-choice")
      answers[question.id] = [...(value as string[])];
    else answers[question.id] = value as string | boolean;
  }
  return answers;
}
