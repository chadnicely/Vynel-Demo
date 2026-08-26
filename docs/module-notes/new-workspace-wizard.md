# New-workspace wizard — the 13 screens, brought to main

*Branch `feature/new-workspace-wizard`. Source: Chad's demo on `design/mission-control-prototype`
(commits `40c5a5e8` engine + `5daf8ff6` web, 2026-08-11). Kafi's decisions 2026-08-23. This note is
the per-module advice build-discipline asks for — read it before touching any slice.*

> **Superseded in part (2026-08-27, the mission-control pull — D2/D3 in
> `docs/module-notes/mission-control-restore.md`).** Chad reversed two of the 2026-08-23 calls for
> the NEW-project path: the wizard now opens on the IDEA and asks only a NAME (screen 9); Finish
> mints `<projects home>/<name>` under `users.projectsDirectory` (default `~/Documents/Vynel`,
> migration 0056) — no folder pick, no path on screen until Finish. Re-using a name ADOPTS the
> existing folder (write-if-absent, never overwrite; only a folder that is already a WORKSPACE
> conflicts — decided over refuse-or-confirm, 2026-08-27). `workspaces.setupCompletedAt` is BACK
> (migration 0057) with the Needs-setup bucket + "Finish setting up". PULL-IN is unchanged: the
> picked folder is used exactly as handed over. The one-shot reads dispatch from the projects home,
> not the not-yet-existing project folder.

## The ask

Chad's demo adds a 13-screen "Walk me through it" wizard to the add-workspace flow: the user
describes an idea, answers a few questions, studies a rival site, rates a plan, approves the MVP and
the build sessions, and ends with a project made and its chat open with the brief seeded. We take
his **screens, copy and flow**; we rebuild the **plumbing** to main's rules (he is non-technical —
the demo sits on decisions main has rejected).

## What main has vs what the demo assumed

| Demo assumption | Main (locked) | Consequence |
|---|---|---|
| Two-level workspaces (`parentWorkspaceId`, projects inside a workspace); groups deleted | Flat workspaces + groups | A new app **is a workspace row**, filed into the group it was opened from. No schema change to workspaces. |
| Fixed `~/Vynel` home for new apps | The user picks folders (FileSystemBrowser, locked) | **Folder first** — the user chooses the app's home on screen 1; never the global space. |
| Per-app account picker (Claude / Codex / Kimi) | One global Claude account; GitHub (later) global in Settings | Screen 10 becomes a **read-only pre-flight**: signed in? (Claude) · GitHub status (later). Nothing chosen, nothing stored per workspace. |
| `gh repo create` on Finish | No GitHub on main | Repo leg deferred to the global GitHub connection arc; screen 9's repo fields hidden until then. |
| `setupCompletedAt` + "Finish setting up" | Doesn't exist | Dropped. *(Reversed 2026-08-27 — D3 brought both back.)* |
| Own `WizardModal` + Nocturne scoped CSS | `@vynel/ui` `Modal` (reka) + Tailwind v4 | Steps restyled; logic ported verbatim. |
| Brief seeded into the composer only | — | **The plan lives in the DB** (Kafi: no `PLAN.md`), plus the composer seed as the live channel. |

## Decisions (Kafi, 2026-08-23)

| Fork | Call |
|---|---|
| Where the app is stored | *(Superseded 2026-08-27 for NEW projects — see the block above.)* **The user's chosen folder IS the workspace** (screen 1; live-smoke correction 2026-08-23 — the first cut minted a child folder from the name, which asked for the name twice and made `vynel-beta\vynel-beta`). The browser's New folder makes an empty one; the name follows the folder until edited, as in "Pull from a folder". The scaffold writes README/.gitignore only if absent, keeps an existing `.git`, and takes back only what it added on failure. The clone needs an EMPTY folder (git's rule) and empties it again on failure. The one-shots dispatch from the folder (`cwd`); a read writes nothing there. |
| Screen order | *(Superseded 2026-08-27 — idea first, name at screen 9; see the block above.)* **Place first**: place → idea → q1 → q2 → rivals → wants → plan → goals → stack → account (pre-flight) → care → sessions → done. |
| Accounts | **Global.** Claude = the signed-in account; GitHub = a global Settings connection when it lands. Never per workspace. |
| Where the plan lives | **The DB**, attached to the workspace — not a file in the folder. |
| How the primary session gets it | Durable: the DB row, readable by the session through a read tool. Live: "Open my app" seeds the brief into the composer; **the user presses send** (building is never a wizard side effect — Chad's rule, kept). |
| "Pull from git" | Yes — Chad's clone door, its own slice (`git clone`, hardened, no `gh`). |

## Honesty lines Chad enforced (do not cross)

- No button that silently does nothing; a disabled control says why beside it.
- Screen 4's "what they do" list is the model's OWN KNOWLEDGE of the named site — label it so; no pretend live analysis.
- No invented values beside real ones — unknown shows dimmed.
- Finish never starts a build.

## Slices (each green on its own, one commit each)

1. **AI seam** — `@vynel/providers`: `shared/workspace-plan.ts`, `studyRivalSite` / `synthesizeWorkspacePlan` (default null), the two Claude one-shots over `runClaudeDistillTurn` (sonnet-5, `parseDistillJson`); `POST /workspaces/wizard/study-rival` + `/plan` (SDK `workspaces.studyRival` / `workspaces.synthesizePlan`) (no x-mcp; `parentPath` → `resolveExistingDirectory` → cwd); SDK regen.
2. **Scaffold + the plan row** — `packages/workspaces/.../scaffold-workspace.ts` (`createChildDirectory` → README with the stack → `git init` + first commit → `createWorkspace` + group); a `workspace_briefs` table next to the workspaces schema (id · userId · workspaceId · answers json · plan json · brief text · createdAt) with `GET /workspaces/:workspaceId/brief` [x-mcp `get_workspace_brief`] so the primary session can re-read the approved plan ("brief", not "plan" — `@vynel/plans` is the daily planner); `POST /workspaces/wizard/scaffold`.
3. **Wizard** — helpers verbatim (`wizard-steps`, `derive-stack`, `derive-fallback-plan`, `build-project-brief`, `wizard-study`) + `WorkspaceWizard.vue` under `components/workspace/wizard/`; shell on `Modal` + a `persistent` prop (closes only via X — Chad, 2026-08-11); 12 steps restyled; Place = name + parent-folder pick; Account = global pre-flight.
4. **Door + kickoff** — Chad's fork (`NewWorkspaceDialog`) on every `openCreateWorkspace` entry point: Walk me through it · Pull from a folder → today's dialog · Create from a repository. **Only doors whose paths exist** (no dead buttons — Chad's rule): "Set it up instantly" joins with Quick Create. Done → `addTab` + `ui.composerSeed` (set after `nextTick` so the seed reaches the NEW chat's composer).
5. **Clone** — `cloneRepositoryWorkspace` (remote-only URL guard, `protocol.ext.allow=never` + `--`, cleanup + git's own reason on failure, then `createWorkspace`) + `POST /workspaces/wizard/clone` (SDK `workspaces.clone`, no x-mcp) + `CloneRepositoryDialog` (address → name follows the repo's base name → the user's own folder pick → Clone it). No brief: the repository IS the history.

Later: Quick Create ("Set it up instantly" — reuses screens 8–10), GitHub as a global Settings connection (then the repo fields + push on scaffold), draft-answer persistence.

## Not taken from the branch

Two-level workspaces · setup stamps · group removal · per-workspace accounts · Codex/Kimi · the
Nocturne retheme · `WizardModal` · the mission-control constellation · the `prototype/` folder.

## Design refs

`prototype/mission-control/design/Onboarding Wizard.dc.html` + `Quick Create.dc.html` on the design
branch (the screens); Chad's ten screenshots in the 2026-08-10 transcript — ask him to re-paste any
screen you need pixel-exact.
