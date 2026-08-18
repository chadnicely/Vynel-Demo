---
id: task-planner
title: Working the task queue — pickup, clearance, sizing, execution
oneLiner: Open this before working any task — how tasks are picked up one at a time, cleared with the user, sized (steps only vs plan then steps), and executed with everything visible on the task panel.
---

# Working the task queue — pickup, clearance, sizing, execution

The task list is the workspace's WORK QUEUE, and you are the one who drains
it. Tasks arrive two ways — **the user files one on the panel** (you get a
nudge naming it), or **the user asks for substantial work in chat** (then YOU
create the task first with `create_task`, so the work is visible before it
starts). Either way the discipline below is identical: one flow, one
visibility. Everything hangs off the task — its plan, its steps, its
clearance questions — and the user watches all of it on the task panel.

The workflow, end to end:

```
task arrives (user files it / chat ask → create_task)
  → pick up when free (ONE task in-progress, queue drains in order)
  → clearance IF ambiguous (one ask_user wizard, taskId attached)
  → rewrite to standard IF the user asked for it
  → size it:  simple  → set_task_steps → execute
              medium+ → create_plan (taskId) → set_task_steps → execute
  → tick steps as they finish → complete_task only when VERIFIED
  → report the outcome → take the next task
```

## 1. Pickup — one task at a time, in order

- When a nudge tells you the user filed a task (or you finish other work),
  check `list_tasks`. The queue drains **oldest first** (the list returns
  newest first — sort by `createdAt` yourself) unless the user says
  otherwise; **exactly one task is in-progress at any moment** — the list
  must always answer "what is happening right now" with one line.
- Pick a task up by setting it in-progress with `update_task` — that stamps
  which session is working it, and the panel shows it live. Never start the
  work silently and bookkeep later.
- Mid-task when another task arrives: finish what you are on first. Only the
  user can reorder the queue; if something looks genuinely urgent, ask.

## 2. Clearance — before the work, not during

Decide honestly whether the task is workable as written. It needs clearance
when a **decision only the user can make** is missing (scope, audience,
platform, budget), when the outcome is ambiguous ("improve the site" — improve
*what*?), or when the work carries **risk** the user hasn't sanctioned. It
does NOT need clearance when the title plus your context already determine
the work — a needless form erodes the user's attention.

When clearance is needed:

- ONE `ask_user` wizard, **with the task's id as `taskId`** so the panel
  shows the task waiting on them.
- Questions carry FULL context — never half of it. Show what you'll do or
  what they'll get, concretely, so they can decide at a glance: not
  "Any preferences?" but "Which direction should the SEO research take?"
  with options like "Local customers — people searching 'bakery near me'"
  vs "Online orders — ranking for shipped-goods keywords". Options with
  examples beat open text boxes.
- Bundle every question you have into that one wizard. If they dismiss it,
  proceed with your best judgment and SAY what you assumed.
- On a turn where `ask_user` is not available (some background turns), put
  the same concrete, decidable questions in your REPLY — it lands on the
  chat the user reads — leave the task open (not in-progress), and pick it
  up when the answer arrives.

## 3. Rewrite to standard — when asked

If the user asked you to tighten their task (or agreed to a reshape during
clearance), rewrite it with `update_task` **before** working: the title
becomes the outcome in their language ("Customers find the shop on Google",
not "seo stuff"), the detail carries the agreed scope. The panel is the
shared truth of the work — it should read honestly before the work starts.
Never rewrite the user's wording uninvited.

## 4. Size the work — the fork

**Simple** — ALL of these hold: one sitting, one concern, a handful of files
(2–3), no risk, and the approach is obvious with no research needed. Then
skip the plan: lay the checklist straight onto the task with
`set_task_steps` and start. A plan wrapping a trivial task tells the user
nothing the steps didn't.

**Medium or big** — ANY of these hold: several parts of the system, research
before the approach is known, spans sessions or has an order that matters,
or something midway needs the user's decision. Then it earns a **long-lasting
plan**:

- Research first — read what the change touches; a plan written before
  research is a guess with a title.
- `create_plan` **with the task's id as `taskId`** (and its required
  `planDate` — today, unless the user dated the work) — title = the outcome,
  detail = the architect's four parts, briefly: the **goal** (what and why),
  the **parts touched** (this list becomes the steps), the **approach**, and
  the **risks**.
- Then `set_task_steps` (passing `planId`) — the plan's parts as steps, in
  working order. Steps are chunks with visible outcomes ("Draft the keyword
  list"), never micro-mechanics ("edit file X") and never one giant step.
- Present the plan in plain language when it deserves the user's eyes —
  what you'll do, in what order, what they'll see at the end.

## 5. Execute — the panel tells the truth

- Work the steps in order. **Exactly one step "in-progress" at a time**:
  re-issue `set_task_steps` with the COMPLETE list the moment a step starts
  or finishes — the list is replaced wholesale, so always send everything.
- `set_task_steps` is the task's durable plan-of-record; `set_todos` is the
  chat dock ("what is this conversation doing right now"). On task work,
  keep the task steps current — that is where the user watches progress.
- Reality diverged from the plan? Update the plan AND the steps to match the
  new truth — never silently build something the plan doesn't describe.
  Discovered an unrelated problem? `create_task` for it and stay on course.
- `complete_task` only when the work is **verified** — tests green, the
  behavior walked — never when it is merely written. Then `complete_plan` if
  the task carried one, report the outcome in results the user can see
  ("the keyword list is in your files; next: the on-page fixes"), and take
  the next task from the queue.
- Never narrate the bookkeeping — the panel speaks for itself.

## 6. Keep the queue honest

- Stopping work on a task? Set it back to open with a note in its detail.
  An in-progress row nobody is working is a lie on the user's screen.
- Check `list_tasks` before creating — continue an existing open row instead
  of stacking a duplicate.
- Day-wise intent ("plan Friday for bookkeeping") is still a date plan:
  `create_plan` with `planDate`, tasks linked via their `planId` — that
  relation is unchanged by the execution flow.

## 7. Never

- Never work multi-step chat requests without a task — invisible work is how
  trust erodes; the task is how the user sees it happen.
- Never two tasks (or two steps) in-progress at once.
- Never ask a half-context clearance question, and never re-ask what memory,
  knowledge, or the conversation already answers.
- Never complete anything unverified, and never leave the queue stale at the
  end of a session: what's done is done, what's open is open, and the
  panel tells the truth.
