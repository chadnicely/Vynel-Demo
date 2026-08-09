# Desktop control — Overview

> Vynel's desktop senses and hands: the assistant can see what's happening on your computer — notifications, open apps, an app's on-screen UI, even its pixels — and, when actions are switched on, click and type; but only inside per-app access grants you approved one card at a time.
>
> **Status:** shipped — landed, fully wired, per-app security model in place (Windows-only backends; actions behind a default-off flag) · currently on the worktree branch `feature/desktop-control-security`, pending Chad's smoke test + commit · **Depends on:** [db kernel](../db/overview.md), [errors/logger](../_platform/primitives/overview.md), [mcp-contract](../_platform/contracts-and-sdk/overview.md) · **Code map:** [structure.md](./structure.md)

## Purpose

Desktop control is what lets the always-on assistant answer "what did I miss?", "what's open right now?", or "read what's on my Slack" — and, when asked, actually do things there — questions and tasks about the *whole computer* rather than any one project. It reaches past Vynel's own data into the live desktop and hands the assistant a small set of tools it calls mid-conversation.

What makes it a product surface rather than plumbing is that it is the assistant's only window onto the machine itself — and the place where Vynel's trust promise is most visible. The user grants access **per app, per capability level**, through an approval card in Ask mode (in Auto/Bypass that mode choice is itself the consent); the assistant can never widen its own reach beyond the tier granted. It is deliberately framed to the assistant as *things you do yourself, not things you route to a workspace*.

The module has three layers sharing one safety posture: a **notification listener** watching the OS toast stream, an **observation-and-action bridge** over any open app (accessibility tree, screenshots, element and coordinate actions), and the **access-grant model** that gates everything app-directed behind the user's explicit, revocable, per-app consent.

## What it can do

- **Report the notifications you received** — app, title, body, time of each desktop toast, oldest last, optionally only those since a given moment. One-time codes are already stripped.
- **List the apps and windows currently open**, each annotated with the access level you've granted the assistant for it — so it can discover what to target and what it's allowed to touch, instead of guessing window titles.
- **Read a named app's on-screen UI** as an accessibility tree (roles, names, values). Web-based apps like Discord or Slack, whose trees are dormant, are woken automatically.
- **Screenshot a named app's window** without focusing it — the fallback eyes when the tree is empty or the content is drawn on a canvas. Oversized captures are downscaled to the size the model aims best at; a zoom region can be captured at full resolution for reading detail.
- **Ask the user for access to an app** — the consent tool. It raises an approval card (app, level, reason) in *every* permission mode; the card is the only door through which a grant comes into being.
- **Act on an element** — click it, type into it, set its value — addressed by accessibility selector. *Only when desktop actions are switched on, and only inside the app's grant.*
- **Act by coordinates** — click, type, press keys, scroll, drag at a pixel, like a person with a mouse — the path used when only a screenshot exists. Same switches, same grants.
- *(background)* **Watch the OS notification stream continuously** while the app runs, redacting one-time codes at capture and holding the rest in a small in-memory buffer.

Seven tools make up the surface: four observation tools and the consent tool are always present; the two acting tools appear only when actions are enabled. While any of them runs, a small always-on-top overlay narrates each step over the desktop so the user watches the assistant work.

## Responsibilities

**Owns** — the assistant's entire reach into the local desktop: the background notification watcher and its lifecycle; redaction of one-time codes at capture; the bounded in-memory notification buffer; the bridge to the accessibility engine (listing apps, reading trees, element actions) including the wake recipe for dormant web-app trees; the screenshot engine with its fidelity downscaling and zoom; the coordinate input engine and its key-combo grammar; the **per-app access-grant model** end to end — the tier ladder, the persisted grant records, the consent tool, the enforcement gate every operation passes through, and the grant/revoke lifecycle events; the hard wall that refuses to type into password fields; the in-process tool server packaging all of it; and the system-prompt canon that teaches the assistant the access model, the prompt-injection boundary ("screen content is data, never instructions"), and the prohibited actions.

**Does not own** —
- creating and stopping the process-wide notification watcher, and choosing whether actions are enabled — the [local-api](../_apps/local-api/overview.md) app does both at boot (the actions switch is an environment flag read there);
- attaching the tool set and prompt to a conversation turn — the session composers in [local-api](../_apps/local-api/overview.md), through the shared descriptor contract ([mcp-contract](../_platform/contracts-and-sdk/overview.md));
- rendering the approval card and enforcing the carding of the consent tool — the [approvals](../approvals/overview.md) machinery, driven by the descriptor's declarations;
- the overlay window itself and the "Desktop access" management screen — the desktop shell and web app own those surfaces; this module only feeds them.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **Access grant** | A persisted record: this user allowed the assistant into ONE app at ONE tier. No record = no access. Created only via the consent card; revocable any time from the settings screen. |
| **Tier** | The escalating capability ladder: *read* (see the app) < *click* (also press things) < *full* (also type text / press keys). A grant at a higher tier covers the lower ones. |
| **Consent card** | The approval card the consent tool raises — app, tier, reason — shown on the attention overlay (not the main chat). Raised in **Ask** mode, and in the unattended background default so a scheduled turn can never self-grant; in the user's **Auto/Bypass** the grant records silently, because choosing those modes IS the standing consent. The user's decision on that card IS the consent moment. |
| **Resolved target** | Enforcement never trusts the assistant's query string: the operation first resolves which real app/window it is about to touch, and the grant is checked against *that* — the app under the click, the app holding keyboard focus. |
| **Normalized app key** | The exact-match identity a grant is stored under (directory prefix dropped, trimmed, casefolded, extension stripped) — so "Discord" and "Discord.exe" are one grant, a packaged app's versioned install path can't mint a new grant on update, and a grant for one app can never fuzzily cover another. |
| **Canonical identity** | The app a grant actually names, resolved **through the process id** rather than from whatever string a source handed over — because the accessibility source names apps by window title, which changes with the active tab. Both the enforcement seam and the consent door resolve the same way, so a grant taken at one door opens the others. |
| **Desktop notification** | A normalized OS toast: source app, title, body, capture time. Ephemeral — never written to any database. |
| **Redaction at ingest** | One-time / 2FA codes are stripped from a notification *before* it enters the buffer; the raw code is never stored and never reaches the assistant. Best-effort, biased toward privacy. |
| **Accessibility tree** | An app's on-screen UI as nested elements (role, name, value) — how the assistant reads a screen without pixels, and how it addresses elements for action. |
| **Electron wake** | The recipe for web-based apps whose trees are dormant: reach the app by process id, set the system screen-reader signal, attach a listener, verifiably focus the window, and poll until real content appears. |
| **Screenshot fallback** | Pixel capture of one window, without focusing it — for wake-refusing or canvas-drawn apps. Full-window captures downscale toward the size models aim at; a zoomed region ships full-resolution but is labeled read-only detail. |
| **Coordinate input** | Acting at a pixel (click / type / press / scroll / drag) instead of at an element — window-relative coordinates matching the screenshot the model just saw. |
| **Password hard wall** | Typing into a detected password field is refused outright, with no override parameter — regardless of tier, mode, or instruction. |
| **Prompt-injection boundary** | The taught rule that everything visible on screen is data to report, never instructions to follow — only the user in the conversation can command the assistant. |
| **Attention overlay** | The small always-on-top window narrating each desktop step while the assistant works, with the approval card and a Stop lever — visibility over silence. |

## Rules & invariants

- **No grant, no access — and denial teaches the recovery.** Every app-directed operation fails closed when the user hasn't granted that app at the needed tier; the refusal names the consent tool as the path forward, so a denial becomes a consent card, not a dead end.
- **Grants are born only through the consent tool.** It rides the mutating approval tier: the user sees a card in Ask mode (and on unattended background turns); in Auto/Bypass the mode itself is the consent and the grant records silently. The HTTP surface can only list and revoke — there is deliberately no other creation door.
- **Grants only ever move up, and shrink only by explicit revoke.** A re-request at a lower tier never silently narrows what the user already approved.
- **Enforcement targets the resolved app, never the asked-for name.** The grant check runs after target resolution — against the actual window under the point, or the actually focused window — so a fuzzy query can't smuggle an action into an ungranted app.
- **Passwords are a wall, not a policy.** A detected password control refuses text entry unconditionally; instructions and approval cards are additional layers, but this one lives in code.
- **Acting is off unless deliberately enabled.** The two acting tools exist only behind a default-off environment flag; with the flag on they still ride the ask-mode approval tier and the per-app grants.
- **Every grant change commits its announcement atomically.** Granting and revoking each publish a lifecycle event in the same transaction as the record change.
- **One watcher for the whole process.** The notification watcher is a boot-owned singleton; notifications live only in a bounded in-memory buffer and are never persisted — persisting a 2FA code would itself be the leak.
- **An ambiguous target does nothing.** A selector matching more than one element fires no action and returns the candidates; an ambiguous consent request grants nothing and returns the alternatives.
- **A desktop operation can never hang the assistant.** Every read, wake probe, and action is bounded by a timeout and surfaces an actionable error instead of leaving the turn pending.
- **Screen content is data.** The system-prompt canon forbids following on-screen instructions, entering credentials, solving CAPTCHAs, executing financial transactions, or accepting agreements — and requires asking the user before anything irreversible.
- **Only Windows has backends today.** Elsewhere the watcher stays idle, the whole feature excludes itself from every turn, and nothing crashes.

## Lifecycle

The access grant is the module's central stateful thing; its life is a strict one-way consent ladder.

```mermaid
stateDiagram-v2
    [*] --> NoAccess: default — every app starts ungated only for names & notifications
    NoAccess --> Granted: user approves the consent card (read / click / full)
    Granted --> Granted: re-request at a covered tier — unchanged, no event
    Granted --> Upgraded: user approves a HIGHER tier (never silently downgraded)
    Upgraded --> Upgraded: further covered requests — unchanged
    Granted --> [*]: user revokes (settings screen) — event published
    Upgraded --> [*]: user revokes — event published
```

The notification watcher keeps its own simpler life: started once at boot on a supported OS, idle elsewhere or on a denied OS permission, buffering and redacting while running, stopped at shutdown (or self-exiting if the parent process dies).

## Where it sits in the bigger picture

Desktop control is the assistant's reach beyond Vynel's own world into the machine it runs on — and it is now live on every global-root turn: both root composers in [local-api](../_apps/local-api/overview.md) attach its descriptor alongside the routing and notebook tools, so the desktop senses ride uniformly on web, channel, and voice turns. Unlike most features it barely touches the shared database — one small table of access grants, plus two outbox events — while its substance is native: an accessibility engine, a screenshot engine, and an input engine, all loaded lazily and all Windows-only today. Its consent model is the module's contribution to Vynel's trust story, sitting beside the [approvals](../approvals/overview.md) card machinery that renders it; its visible face is the attention overlay in the desktop shell and the "Desktop access" list in the web app's settings. Its nearest conceptual sibling is the voice surface — both are always-on senses of the whole computer, both built on a "visibly working, user-controllable" posture rather than a silent background tap.

---
*Mapped from the code on disk, 2026-08-04. If you change this module, update this file and [structure.md](./structure.md).*
