# Desktop shell — Phase 2: design spec

*Senior-design pass for the reinvented `apps/local-web` shell. Tailwind + Reka UI, Tauri-aware.
Builds on the Phase-1 inventory (`docs/desktop-shell-inventory.md`).*

---

## Design thesis

**"A calm control room, not a terminal."** Vynel hands a genuinely powerful agent to people who
bounced off Claude Code / Desktop because those tools *feel* like developer instruments. So the shell's
job is the opposite of a terminal: make a strong agent feel like a **quiet, legible, trustworthy
desktop application** that belongs on the machine.

We are **not** discarding the visual identity — it's already distinctive and not one of the AI-design
clichés (no warm-cream-serif, no near-black-acid-accent, no broadsheet). We keep and sharpen it:

- **Cool slate depths** — a 4-step surface ladder, nearly monochrome. The UI recedes; the content leads.
- **Gold = presence, and nothing else.** The single warm accent is reserved for *the assistant being
  alive*: running, streaming, or waiting on you. If it glows gold, the assistant is doing something there.
- **Coral spark = identity.** Claude's mark is the one coral note — identity, never presence.
- **Native type on purpose.** We use the OS's own optical font (Segoe UI Variable / system stack), not
  a characterful display serif. For an app that wants to *feel native*, borrowing the platform's own
  letterforms is the intentional choice, not a neutral default.

**The one risk (the signature): presence-aware chrome.** The window frame itself reports the assistant's
state. The title bar's base hairline and the status-bar dot speak one gold-presence language: a slow
*breathing* gold hairline along the title bar while the assistant works; a steady gold when it needs you
(approvals). "What is my assistant doing?" becomes answerable from the frame alone, at the edge of vision,
always. Everything else stays disciplined and quiet so this one thing carries.

---

## Shell layout

One compact **title bar with an integrated menu** (the modern Windows 11 / VS Code pattern — it satisfies
both "title bar" and "menu bar with dropdowns" in a single 40px bar instead of stacking 70px of chrome),
a resizable **left nav**, the **canvas**, a resizable **right context panel**, and a thin **status bar**.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◈  Vynel  Assistant  View  Go  Help        Global chat · ⣿ working   – ▢ ✕ │  40px  title + menu + presence + window controls
├─────────┬────────────────────────────────────────────────┬───────────────┤
│         │                                                  │               │
│  Home   │                                                  │   History     │
│  Chat   │                 CANVAS                           │   Files       │
│  Work…  │            (thread / section / editor)           │   Trace       │
│ ─────── │                                                  │  (tabbed,     │
│ Channels│                                                  │   dockable)   │
│ Memory  │                                                  │               │
│ Know…   │                                                  │               │
│ …       │◂ 6px drag handle                  6px drag ▸     │               │
├─────────┴────────────────────────────────────────────────┴───────────────┤
│ ● idle · Global · model: Sonnet · memory ready            2 approvals ▸    │  22px status bar
└──────────────────────────────────────────────────────────────────────────┘
        ▲ left nav 240px (180–420, collapsible)     right panel 320px (240–560, hidden by default) ▲
```

**Regions**

| Region | Size | Behavior |
|---|---|---|
| Title bar | 40px | App icon + menu bar (dropdowns) · center = window title + presence (drag region, `data-tauri-drag-region`) · right = window controls. **Simulated controls in the browser; real OS controls under Tauri** (detect at runtime; hide the simulated cluster when Tauri owns them). |
| Left nav | 240px, 180–420, resizable + collapsible | Primary places (Home / Chat / Workspace) at top; contextual menu below (global feature sections, or the active workspace's sections). Unifies today's SegmentedTabs **and** the hamburger MenuPanel into one desktop sidebar. |
| Canvas | fluid | The thread, a feature section, or the file editor — as today. |
| Right context panel | 320px, 240–560, resizable, hidden by default | Tabbed dock unifying today's SessionsPanel (History), FilesPanel (Files, workspace only), and SessionViewerPanel (Trace). Open via View menu / shortcut / context action. |
| Status bar | 22px | Presence dot + scope + model + subsystem readiness (memory/knowledge) on the left; pending-approvals affordance on the right. New surface — a quiet, always-there truth line. |

**Panel sizes persist** to `localStorage` (`vynel.layout.*`) — reload returns you to your layout.
Dividers: 1px hairline, ~6px hit target, gold on hover/drag, double-click to reset to default.

> **Menu vocabulary — a deliberate adaptation.** The brief said "File/Edit/View style," but File/Edit/View
> is developer-tool language for a product built for non-technical people. We keep the menu-bar *affordance*
> and give the menus names people recognize: **Vynel** (about · settings · sign in/out · quit) · **Assistant**
> (new chat · new workspace · start voice · interrupt) · **View** (toggle panels · theme · zoom · command
> palette) · **Go** (Home · Chat · Workspace · recent) · **Help** (docs · keyboard shortcuts). Flagged so you
> can veto — but naming by what the user controls is the right call for this audience.

---

## Design system — Tailwind theme tokens

Full migration to **Tailwind v4**, bridged from the existing `tokens.css` so nothing about theming
breaks. The semantic CSS variables stay the source of truth (defined per-theme under `:root` /
`[data-theme="light"]`); `@theme inline` maps them to Tailwind utilities, so `bg-panel text-ink-1
border-hair` etc. *just work* and respond to the theme toggle automatically.

```css
/* tokens.css keeps the values (dark default + [data-theme="light"] override) — unchanged.
   This block turns them into utilities. */
@theme inline {
  /* Surfaces → bg-shell / bg-panel / bg-raised / bg-overlay */
  --color-shell: var(--bg-shell);
  --color-panel: var(--bg-panel);
  --color-raised: var(--bg-raised);
  --color-overlay: var(--bg-overlay);
  /* Ink → text-ink-1 / text-ink-2 / text-ink-3 */
  --color-ink-1: var(--ink-1);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  /* Hairlines → border-hair / border-hair-strong */
  --color-hair: var(--hair);
  --color-hair-strong: var(--hair-strong);
  /* Presence (assistant only) → text-gold / bg-gold-soft / … */
  --color-gold: var(--gold);
  --color-gold-bright: var(--gold-bright);
  --color-gold-soft: var(--gold-soft);
  /* Identity (Claude) → text-claude */
  --color-claude: var(--claude-mark);
  --color-claude-soft: var(--claude-mark-soft);
  /* Status → ok / danger / info · file-* · ws-1..6 (as today) */

  /* Compact type scale (desktop density) */
  --text-2xs: 0.656rem;   /* 10.5px — meta/eyebrows */
  --text-xs:  0.719rem;   /* 11.5px — hints, chips */
  --text-sm:  0.781rem;   /* 12.5px — labels, rows */
  --text-base:0.844rem;   /* 13.5px — body (matches today) */
  --text-lg:  1rem;       /* 16px */
  --text-xl:  1.25rem;    /* 20px */
  --text-display: 1.75rem;/* 28px — the welcome greeting only */

  /* Fonts */
  --font-sans: var(--font-ui);
  --font-display: var(--font-display);
  --font-mono: var(--font-mono);

  /* Radius → rounded-sm/md/lg */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;

  /* Elevation → shadow-raised / shadow-overlay */
  --shadow-raised: 0 1px 2px rgb(0 0 0 / .3), 0 4px 16px rgb(0 0 0 / .25);
  --shadow-overlay: 0 4px 12px rgb(0 0 0 / .4), 0 16px 48px rgb(0 0 0 / .35);

  /* Motion */
  --ease-out: cubic-bezier(.22,1,.36,1);
  --default-transition-duration: 120ms;   /* the 100–150ms the brief wants */
}
```

- **Spacing:** keep Tailwind's 4px base; chrome uses `1–3` units (4/8/12px). Density is enforced by the
  compact type scale + tight paddings, not a custom spacing ramp.
- **Focus:** one ring everywhere — `outline: 2px solid var(--gold); outline-offset: -2px` via a
  `focus-visible` utility. Custom, gold, consistent (the brief's "custom focus states").
- **Light/dark:** unchanged mechanism — `[data-theme]` on `<html>`, driven by `ui-store`. Every token
  already has a light value.

---

## Components to build (behaviors)

Built once in `@vynel/ui`, styled with the tokens above. These are the "modern components" the brief
lists — and they retire the duplicated, incomplete overlay/menu logic the inventory found.

| Component | Behavior |
|---|---|
| **Menu / Dropdown** (`Menu`, `MenuItem`, `MenuSeparator`, `MenuCheckboxItem`) | The menu-bar dropdowns and every generic dropdown. Click or keyboard to open; roving arrow-key focus; type-ahead; `Esc`/click-outside close; right-aligned shortcut hints; submenus; checkable items. Collision-aware placement (flip/shift). **Replaces** WorkspaceSwitcher's hand-rolled popover and SelectChip's inline menu. |
| **Context menu** (`ContextMenu`) | Right-click surfaces: a message (copy, retry, open in trace), a file row (open, reveal, rename), a workspace (switch, settings). Same menu primitive, opened at the pointer. |
| **Tooltip** | Hover/focus delayed reveal (≈400ms open, instant between neighbors), single-line, for icon-only controls. **Today there is none** beyond native `title` — this is the first real tooltip. Respects `prefers-reduced-motion`. |
| **Split pane** (`SplitPane`, `SplitHandle`) | The signature interaction — **hand-rolled** per the brief. Pointer-drag dividers resize left nav & right panel; min/max clamps; double-click resets; **sizes persist to `localStorage`**; keyboard-resizable (arrows when the handle is focused); collapse/expand. No layout jank (grid-template-columns driven by a reactive size). |
| **Command palette** (`CommandPalette`) | `⌘K` / `Ctrl+K`. Fuzzy over actions (new chat, switch workspace, toggle panels, theme, go to section, run a skill). Grouped results, keyboard-first, recent actions on top. The power-user spine that keeps the calm surface uncluttered. |
| **Dialog / Modal** (`Modal`) | One accessible base (focus-trap, `Esc`, backdrop, scroll-lock) — **replaces the 6+ dialogs that each re-implement Teleport + backdrop today.** Existing dialogs re-home onto it. |
| **ConfirmButton** | The "arm-then-confirm" destructive idiom, currently copy-pasted in 4+ places, as one component. |

**Stack for behavior:** these get their interaction/accessibility from **Reka UI** (headless, WAI-ARIA,
keyboard-complete — the Radix-for-Vue that shadcn-vue builds on), skinned entirely with our tokens. That
buys correct focus management, positioning, and a11y we'd otherwise hand-roll and get subtly wrong (the
inventory shows we already do). The **SplitPane stays hand-rolled** — it's the brief's signature ask and
simple enough to own outright. `⌘K` fuzzy matching uses a tiny matcher; no heavyweight dep.

---

## Migration approach (incremental — never big-bang)

Project discipline still holds: *move, then improve; green at every step.* Full Tailwind is the
destination, reached in order — not a rewrite.

1. **Token bridge.** Add Tailwind v4 + the `@theme inline` map above. `tokens.css` values stay. Nothing
   visual changes yet; utilities become available. Gate green.
2. **Primitives.** Build the component library (Menu, ContextMenu, Tooltip, SplitPane, CommandPalette,
   Modal, ConfirmButton) in `@vynel/ui`, Tailwind-styled, with tests. Nothing wired yet.
3. **Shell.** Build the new shell (title bar + integrated menu, left nav, split panes, right dock, status
   bar), Tauri-aware window controls, presence-aware chrome. Wire the existing views into it.
4. **Re-home + convert.** Move the 6 dialogs onto `Modal`; the two bespoke dropdowns onto `Menu`. Then
   convert components to Tailwind utilities folder-by-folder, deleting scoped CSS as each is proven.

Each step ships its tests and stays `pnpm test`-green. Steps 1–3 are the Phase-3 build; step 4 continues
after, component-by-component, until scoped CSS is gone.

---

## What Phase 3 delivers, and the one thing to confirm

**Phase 3 build = steps 1–3:** Tailwind token bridge · the primitive library · the new desktop shell
wired to the existing views, sizes persisted, native-feel details (system fonts, compact density, no
text-select/cursor on chrome, thin scrollbars, no overscroll bounce, 100–150ms transitions, gold focus).

**Confirm before I build:** adopting **Reka UI** as the headless behavior layer. It's the high-leverage,
modern-standard choice (and pairs exactly with the Tailwind direction), but it's the one new runtime
dependency and a shift from the codebase's hand-roll-everything ethos — so it's a "get Chad's okay"
moment. If you'd rather stay dependency-light, I'll hand-roll the primitives instead (more code, and we
own the a11y/positioning risk). Recommendation: **take Reka UI.**
