// The Ask question/answer contract — the ONE definition of what an `ask_user`
// form can contain, shared by the asks leaf (persist + validate), the routes
// (answer boundary), and the UI (render the wizard). Contracts ships values
// elsewhere (VERIFIED_SKILL_CATALOG precedent), so the pure validator lives
// here too — one home, no drift between what the tool accepts and what the
// answer route enforces.

import { z } from 'zod'

export const ASK_QUESTION_TYPES = ['text', 'choice', 'multi-choice', 'yes-no', 'number'] as const
export type AskQuestionType = (typeof ASK_QUESTION_TYPES)[number]

export const ASK_MAX_QUESTIONS = 10
export const ASK_TEXT_ANSWER_MAX_LENGTH = 4000

const OptionSchema = z.string().min(1).max(120)

export const AskQuestionSchema = z
  .object({
    // Stable key the answers object is keyed by (e.g. "server-host").
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'question ids are lowercase kebab-case'),
    label: z.string().min(1).max(200),
    hint: z.string().min(1).max(300).optional(),
    type: z.enum(ASK_QUESTION_TYPES),
    // Required by DEFAULT — an optional question declares `required: false`.
    required: z.boolean().optional(),
    options: z.array(OptionSchema).min(2).max(12).optional(),
    placeholder: z.string().min(1).max(120).optional(),
  })
  .superRefine((question, ctx) => {
    const needsOptions = question.type === 'choice' || question.type === 'multi-choice'
    if (needsOptions && question.options === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a "${question.type}" question needs 2-12 options`,
      })
    }
    if (!needsOptions && question.options !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a "${question.type}" question takes no options`,
      })
    }
  })

export const AskQuestionsSchema = z
  .array(AskQuestionSchema)
  .min(1)
  .max(ASK_MAX_QUESTIONS)
  .superRefine((questions, ctx) => {
    const ids = new Set(questions.map((question) => question.id))
    if (ids.size !== questions.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'question ids must be unique' })
    }
  })

export type AskQuestion = z.infer<typeof AskQuestionSchema>

// One answer value per question id. The concrete shape depends on the
// question type — `validateAskAnswers` is the type-aware check.
export const AskAnswerValueSchema = z.union([
  z.string().max(ASK_TEXT_ANSWER_MAX_LENGTH),
  z.array(z.string().max(120)).max(12),
  z.number().finite(),
  z.boolean(),
])
export const AskAnswersSchema = z.record(z.string(), AskAnswerValueSchema)

export type AskAnswerValue = z.infer<typeof AskAnswerValueSchema>
export type AskAnswers = z.infer<typeof AskAnswersSchema>

export type AskAnswersValidation =
  | { ok: true; answers: AskAnswers }
  | { ok: false; problems: string[] }

// Type-aware answer validation against the question set. PURE (contracts has
// no error-package dep) — callers map `problems` onto their own error type.
// Unknown keys are rejected (an answer must belong to a question); optional
// unanswered questions are simply absent from the result.
export function validateAskAnswers(
  questions: readonly AskQuestion[],
  answers: AskAnswers,
): AskAnswersValidation {
  const problems: string[] = []
  const questionsById = new Map(questions.map((question) => [question.id, question]))

  for (const key of Object.keys(answers)) {
    if (!questionsById.has(key)) problems.push(`"${key}" does not match any question`)
  }

  const normalized: AskAnswers = {}
  for (const question of questions) {
    const value = answers[question.id]
    const isRequired = question.required !== false
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      if (isRequired) problems.push(`"${question.id}" needs an answer`)
      continue
    }
    const problem = checkAnswerType(question, value)
    if (problem) {
      problems.push(problem)
      continue
    }
    normalized[question.id] = value
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, answers: normalized }
}

function checkAnswerType(question: AskQuestion, value: AskAnswerValue): string | null {
  switch (question.type) {
    case 'text':
      return typeof value === 'string' ? null : `"${question.id}" expects text`
    case 'yes-no':
      return typeof value === 'boolean' ? null : `"${question.id}" expects yes or no`
    case 'number':
      return typeof value === 'number' ? null : `"${question.id}" expects a number`
    case 'choice':
      if (typeof value !== 'string') return `"${question.id}" expects one of its options`
      return question.options?.includes(value)
        ? null
        : `"${question.id}" got a value that is not one of its options`
    case 'multi-choice': {
      if (!Array.isArray(value)) return `"${question.id}" expects a list of its options`
      const invalid = value.filter((entry) => !question.options?.includes(entry))
      return invalid.length === 0
        ? null
        : `"${question.id}" got values that are not among its options`
    }
  }
}
