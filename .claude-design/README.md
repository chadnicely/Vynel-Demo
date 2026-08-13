# CODING AGENTS: READ THIS FIRST

`project/` is a git-tracked **mirror** of Vynel's Claude Design project on claude.ai/design —
HTML/CSS/JS mockups Chad designs with the AI design tool, exported as a zip so a coding agent can
implement them for real. `/sync-design <zip>` replaces the mirror wholesale and commits, so
**`git diff .claude-design/` between syncs shows exactly what changed upstream** — design
iterations are traceable history, the same way code is.

## The designs

- **`project/Onboarding Wizard.dc.html`** — the primary design: the **"New app" onboarding
  wizard**, a modal flow over the desktop workspace. Thirteen steps (`STEPS` in its script):
  idea → questions (q1, q2) → rivals (study a competitor site, tick its features) → wants →
  plan (with a 1–10 rating gate) → MVP goals → stack → name/folder/GitHub repo → account →
  security → build sessions (approve the roadmap) → done.
- **`project/Vynel Workspace*.dc.html`** — the workspace shell itself in six states: default,
  Task Detail, Needs Input, Problem, Completed, Cross Project.
- **`project/_ds/nocturne-*/`** — the **Nocturne design system** the canvases consume. Read its
  `readme.md`; take every color, font, spacing, radius and shadow from the `styles.css` tokens.
- `project/uploads/` — reference images dropped into the design chats; `project/screenshots/` —
  captures taken while designing; `project/support.js` — the canvas runtime shim.

## How to read a `.dc.html` canvas

These are prototypes, **not production code**. Recreate them faithfully in the target app's real
stack — match the visual output; don't copy the prototype's internal structure unless it fits.
Everything you need is spelled out in source, so **don't render or screenshot them unless asked**:
the markup + Nocturne tokens are the layout spec, and the `<script type="text/x-dc">` block at the
bottom (a `DCLogic` class driving `sc-if` / `sc-for` / `{{ }}` bindings) is the intended behavior,
state by state.

## House rules

- `project/` is a pure mirror — **never hand-edit it**; edits die on the next sync. Hand-authored
  design notes live at this level (like this file) or in `docs/`.
- Resync with `/sync-design <path-to-export.zip>` (see `.claude/commands/sync-design.md`).
- If anything in a design is ambiguous, ask Chad before implementing.
