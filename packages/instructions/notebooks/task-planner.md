---
id: task-planner
title: Planning work — when to plan, when to just task
oneLiner: Open this before starting any piece of work — how to size it, when a large change earns a plan with tasks against it, and when a small one is a single task done and completed.
---

# Planning work — when to plan, when to just task

The plan and task lists are how your work becomes VISIBLE. The user sees
both in their panel — what you're doing, what's done, what's next — so the
lists are the shared truth of the work, not private scratch notes. The rule
that follows: **no multi-step work happens invisibly.** Before touching
anything, size the work and pick the right shape with the plan and task
tools (`create_plan` / `update_plan` / `complete_plan`, `create_task` /
`update_task` / `complete_task`).

## 1. Size the work first — the fork

**Small work → one task, no plan.** It's small when ALL of these hold:
- One sitting, one concern, a handful of files.
- The approach is obvious — no research needed to know what to do.
- No decision the user must make midway.

Then: `create_task` (clear outcome title) → mark it in-progress → do the
work → verify → `complete_task`. Done. Creating a plan for this is noise —
a plan wrapping one trivial task tells the user nothing the task didn't.

**Large work → a plan, then tasks against it.** It's large when ANY hold:
- It touches several parts of the system (backend + UI, several features).
- It needs research before the approach is known.
- It spans sessions, or has an order that matters (this before that).
- Something midway needs the user's decision or approval.

Then follow the architect flow below. Starting large work without a plan
is how projects drift: three sessions in, nobody — including you — can say
what's left.

## 2. Architect the plan (large work)

**Research before planning — modify nothing.** Read the code and files the
change touches, understand what exists, how it connects, and what could
break. A plan written before research is a guess with a title.

Then create ONE plan:

- **Title** = the outcome ("Customers can pay by card"), not the activity
  ("payment work").
- **Detail** carries the architect's four parts, briefly:
  the **goal** (one paragraph — what and why), the **parts touched** (each
  area the work lands in — this list becomes the tasks), the **approach**
  (how, at high level), and the **risks** (what to watch).
- Present the plan to the user in plain language — what you'll do, in what
  order, what they'll be able to see at the end — and **get a yes before
  creating the tasks or touching code.**

**Then one task per part** — `create_task` with the plan's id so each task
rides the plan:

- One task per coherent part of the plan, in working order. Never
  micro-tasks ("edit file X") and never one giant task mirroring the whole
  plan — a task is a chunk of work with a visible outcome.
- The task's **detail holds its steps** as a short checklist. Steps live
  inside the task; if you feel the urge to split a part into more tasks,
  add steps instead.

## 3. Work the plan — one task at a time

- Set the ONE task you're working to in-progress (`update_task`); do its
  steps; tick them off in the detail as you go. Never two tasks
  in-progress at once — the list should always answer "what is happening
  right now" with one line.
- `complete_task` only when the work is **verified** — tests green, the
  behavior walked — never when it's merely written. A done that isn't done
  poisons the whole list's trust.
- Between tasks, report progress in outcomes ("orders now save; next:
  the confirmation email"), and surface anything the plan didn't foresee.
- When every task is done, `complete_plan`, and tell the user what changed
  end to end and how they can see it.

## 4. Keep the lists honest

- **No stale rows.** Stopping work on a task? Set it back to open with a
  note in its detail. Abandoning it? Say so to the user and update it —
  an in-progress row nobody is working is a lie on their screen.
- **Scope changes go through the plan.** If reality diverges from the
  plan mid-work, `update_plan` (and its tasks) to match the new truth —
  never silently build something the plan doesn't describe.
- **Discoveries become tasks, not detours.** Mid-task you find an
  unrelated problem: create a task for it (on the plan if it belongs
  there) and continue — don't wander off the current task.
- Check `list_tasks` / `list_plans` before creating — continue an existing
  open row instead of stacking a duplicate.

## 5. Never

- Never run multi-part work with no plan "to save time" — the plan IS the
  time-saver by the second session.
- Never plan-wrap a trivial task — noise erodes the user's attention.
- Never complete anything unverified, and never leave the lists stale at
  the end of a session: what's done is done, what's open is open, and the
  user's panel tells the truth.
