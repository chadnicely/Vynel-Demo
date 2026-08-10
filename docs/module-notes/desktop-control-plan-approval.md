# Desktop control — plan-level approval (Arc 1a)

**Direction (Kafi, 2026-08-11).** Desktop control is functional but the consent UX is wrong for
the product: in ask mode every `act_on_app` / `act_on_desktop` call raises its own approval card.
The user should approve **the plan once**, then watch the steps run. The overlay must always show
what Claude is doing (any mode — ask only adds the card), and the user acknowledges up front that
AI can make mistakes (the recommended posture is an isolated machine; remote driving via channels
is the long-term vision).

## The model

One new tool, `propose_desktop_plan({ goal, steps, apps: [{app, tier}] })`, and a **turn-scoped
plan envelope** inside the desktop MCP server (the server is built fresh per turn, so the envelope
dies with the turn — no schema, no persistence).

- **Plan-first is uniform:** in EVERY mode, the act tools refuse until a plan is armed (the error
  names the recovery). That is what guarantees the overlay always has a plan + steps to narrate —
  the only per-mode difference is whether the plan raises a card.
- **The act tools leave the ask-approval tier;** `propose_desktop_plan` takes their place. In ask
  mode the plan cards ONCE; approved ⇒ the handler runs ⇒ envelope armed ⇒ acts run card-free.
  Denied ⇒ handler never runs ⇒ acts stay locked.
- **One-time grants (Kafi's call):** plan approval authorizes the plan's apps at their stated
  tiers **for this turn only** — no `desktop_app_grants` rows are written. Standing grants via
  `request_desktop_access` remain a separate, unchanged layer (and still satisfy an act when the
  envelope doesn't cover the app).

## Consent derivation (mode → what an armed envelope may authorize)

`deriveDesktopPlanConsent(permissionMode)` — one home, called by both global-root turn sites:

| Turn mode | `DesktopPlanConsent` | Envelope authorizes its apps? | Plan cards? |
|---|---|---|---|
| `ask` | `approval-card` | yes — the card WAS the consent | yes (once) |
| `auto` / `bypass` | `standing-consent` | yes — those modes are standing consent (Chad 2026-08-04) | no |
| absent (channels / unattended `bypass-with-behavior-gate`) | `display-only` | **no** — standing grants only; preserves "a background turn can never self-grant" | no (ask-tier doesn't card there) |

Remote driving (Telegram) therefore works on already-granted apps and parks a card for new ones —
exactly the pre-existing posture.

## Consent fidelity

Envelope matching is **exact-normalized-key only** (`normalizeDesktopAppKey`), same rationale as
grants: the card names what gets authorized; fuzzy matching is a security hole. A plan may name a
**not-yet-open** app (launch lands in Arc 3), so plan apps are NOT resolved against live windows at
propose time — enforcement happens at act time against the resolved target, keeping coordinate
confinement + hit-test intact. Mismatch ("Chrome" vs "Google Chrome") ⇒ denied act with both
recovery paths (re-propose with the exact name, or request_desktop_access); accepted friction.

## Irreversible actions under a plan

The plan card is the consent for what the plan **states**. Instructions change accordingly: steps
must name irreversible outcomes explicitly ("send the message", "delete the file"); an
irreversible action NOT stated in the approved plan still requires checking with the user first.

## Card + copy

The approval card renders the plan legibly (goal as headline, numbered steps, apps with tier
words) with the acknowledgment as a small footer line — Kafi: *"add that as small message bottom
of that box"* — "AI can make mistakes. Approving runs this whole plan on your computer without
asking step-by-step."

## Deliberately NOT in this arc

- Batched actions in one act call → Arc 1b.
- Overlay active-control banner + live plan progress + all-modes reveal verification → Arc 2.
- `list_installed_apps` / `launch_app` → Arc 3.
- Input-method research note + `driving-the-desktop` notebook book → Arc 4.
- A settings toggle replacing the `VYNEL_DESKTOP_ACT_ENABLED` env flag (with the full
  isolated-machine acknowledgment) → future arc, flagged to Chad.
