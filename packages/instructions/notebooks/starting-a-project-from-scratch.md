---
id: starting-a-project-from-scratch
title: Starting a project from scratch — from idea to build plan
oneLiner: Open this on the first message in a fresh workspace, before touching anything — how to turn a user's idea into a researched stack, a written foundation, and a phased build plan.
---

# Starting a project from scratch — from idea to build plan

The user arrives with an idea, not a spec. They don't know what a scaffold,
stack, database, or repo is — and they never need to. Your job is to carry
the idea from conversation to a foundation the project can grow on for
years. **Do not create a single file until steps 1–4 are done and the user
has said yes to the plan.**

## 1. Understand the vision first

The first message is the seed, not the requirements. Draw the rest out in a
short conversation — a few everyday questions at a time, never a checklist
dump:

- **What should exist when this works?** Have them describe a person using
  it: who they are, what they do with it, what they get out of it.
- **What is the ONE thing it must do well?** The core loop everything else
  hangs off.
- **How big is the dream?** "Just for me", "my customers", "thousands of
  people someday" — this shapes the foundation, not the first version.
- **Is there anything it must work with?** Their phone, a spreadsheet they
  live in, WhatsApp, an existing website, money changing hands.

Reflect the vision back in their own words — one short paragraph, "here's
what I understand you want" — and get a yes before researching anything.

## 2. Research before choosing

With the vision clear, research with the latest data — never from memory
alone. Best practice moves; what was right two years ago may be legacy now.

- Search for how products like this are built **today**: the going stack,
  the pitfalls people hit, what scales and what doesn't.
- Check the realities that will bite later: hosting cost, app-store rules,
  payment providers, data/privacy rules for their region — anything the
  vision touches.
- Prefer **boring, proven technology** with a large community over the new
  and shiny. The user cannot rescue an abandoned framework; a stack with
  ten years of answers on the internet protects them.
- Pick the **smallest stack that can grow to the dream** — sized for the
  dream's direction, but never for scale the project doesn't have yet.

## 3. Decide the foundation — and recommend, don't survey

Make the calls a technical co-founder would, and explain each in one plain
sentence of consequence ("everything lives in one place, so nothing gets
lost between projects"). Decide:

- **Stack and language** — one primary language wherever possible; fewer
  moving parts beats theoretical best-of-breed per layer.
- **One repo or several** — default to ONE repository. Reach for a monorepo
  layout (apps + shared packages) only when there are genuinely multiple
  apps sharing code; never split into separate repos a non-technical user
  would have to keep in sync.
- **Database** — none if nothing is remembered; SQLite while the project is
  small (one file, zero setup, easy to back up); a managed Postgres when
  real users and concurrent writes arrive. Never make the user run a
  database server.
- **Where it will live** — their machine while building; name the likely
  host early so nothing built today blocks publishing later.

If two options are truly close, offer at most two with one plain trade-off
each and recommend one.

## 4. Write the foundation down — this is how the project stays managed

Before building, create a `docs/` folder in the project and write four short
documents. Every future working session reads these first — they are how the
project keeps its direction across weeks of small steps:

- **`docs/vision.md`** — the user's vision in their words: who it's for,
  the core loop, the dream size, what "done" means for version one.
- **`docs/architecture.md`** — the chosen stack, repo shape, database, and
  hosting target, each with the one-line WHY, so no future session
  re-litigates or contradicts a settled call.
- **`docs/guidelines.md`** — the coding rules for this project: structure,
  naming, testing bar, what never to do. Small and specific beats long and
  generic.
- **`docs/roadmap.md`** — the phased plan from step 5, updated as phases
  complete. The user can open this file and see where their project stands.

Keep them short. A page each is plenty; they exist to be read every session,
not admired.

## 5. Phase the build — little by little, always demonstrable

Slice the road to the vision into phases, each ending in something the user
can **see and try** — never a phase of invisible plumbing:

- **Phase 1 is the smallest version that is genuinely useful** — the core
  loop working end to end, nothing else. Everything beyond it is listed
  under "later", visibly not forgotten.
- Each phase gets one line in `docs/roadmap.md`: what the user will be able
  to do when it's done.
- Inside a phase, build in small verified steps: build, run it, verify the
  behavior yourself, commit. Never stack a second unverified change on a
  first.

## 6. Get the yes, then build

Present the whole plan in one short message: the vision as you understand
it, the shape you chose in plain words, and what phase 1 will let them do.
Get a clear yes before scaffolding anything.

Then set up the project (git from the first commit, the `docs/` folder, the
scaffold), and start phase 1. If it's a website or web app, open the
**web-app-scaffold** playbook for the build itself; keep the user oriented
throughout with the **communicating-with-users** rules. End every session by
updating `docs/roadmap.md` and telling the user what works now, what's next,
and how they can see it themselves.
