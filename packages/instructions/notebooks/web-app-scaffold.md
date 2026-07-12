---
id: web-app-scaffold
title: Building a web app for a non-technical user
oneLiner: Open this before building any website or web app for the user — the roadmap from first conversation to a working, tested result.
---

# Building a web app for a non-technical user

The user wants a working thing, not a codebase. They will not manage the
stack, the structure, or the testing — you do, and you keep them oriented in
plain language at every step. Follow this roadmap in order.

## 1. Clarify the requirements in plain language

Before any code, get answers to these — asked as everyday questions, never as
a requirements checklist:

- **Who is it for and what should it let them do?** ("Customers book a table",
  "I post my portfolio", "Staff log their hours".)
- **Does it need to remember anything between visits?** Accounts, orders,
  saved entries → you need storage and probably a backend. Pure reading
  material → you likely don't.
- **Where will it live?** A domain they own, a free host, just their machine
  for now?
- **What does "done" look like for the first version?** Trim to the smallest
  version that is genuinely useful; list the rest as "later".

Reflect the plan back in one short paragraph and get a yes before building.

## 2. Choose the scaffold — static site vs application

- **Static site** (brochure, portfolio, docs, landing page): plain HTML/CSS or
  a static generator. No backend, no database, cheapest to host. Prefer this
  whenever nothing needs to be remembered per visitor.
- **Application** (interactivity, data entry, accounts): scaffold with
  **Vite + Vue 3** (`npm create vite@latest`) as the default choice. Add a
  backend only when the data truly must live server-side; reach for Nuxt when
  the app needs server rendering or routing conventions out of the box.
- Check what already exists first: if the user has a site or a repo, extend
  it — never scaffold a parallel project next to a living one.

## 3. Set up a clean project structure

- One folder per concern, named for what it contains; keep the root shallow.
- Initialize git immediately and commit the fresh scaffold before touching it
  — the first known-good checkpoint.
- Add a README with two lines: what this is, and how to run it.

## 4. Build in small verified steps

- Slice the work into steps that each produce something the user could look
  at ("the page shows your three services", "the form saves an entry").
- After each step: run the app, verify the step's behavior yourself, commit.
  Never stack a second unverified change on top of a first.
- When a step breaks, fix it before moving on — root cause, not workaround.

## 5. Testing discipline

- Verify every user-visible flow by exercising it the way the user would:
  load the page, click the button, submit the form, reload.
- If the project has a test runner, add a test alongside each behavior you
  build and keep the suite green; if it doesn't, don't bolt one onto a
  ten-line site — manual verification of every flow is the bar.
- Before calling anything done, walk the whole happy path once, end to end,
  on a fresh load.

## 6. Explain progress like a person, not a terminal

- Report in outcomes: "People can now book a table and you get an email",
  never "wired the POST handler".
- When you need a decision, offer at most two options with a plain trade-off
  and a recommendation.
- Before anything irreversible or costly (publishing publicly, buying a
  domain, deleting data), stop and confirm — show what will happen first.
- End each session by saying what works now, what's next, and how they can
  see it themselves.
