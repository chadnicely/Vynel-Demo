# Desktop control — plan-level approval + batching (Arcs 1a · 1b)

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

## Arc 1b — batched actions (SHIPPED)

Both act tools take `actions[]` (up to 20) instead of one action, so click → type → press enter is
ONE tool call rather than three model round-trips. Semantics live once in `mcp/act-batch.ts`:
sequential, **stop at the first failure** (the desktop is stateful — a step after a failed one
would act on a screen the model never saw), with a numbered per-step report naming what ran, what
stopped it, what never ran, and the re-observe path.

**Batching weakens nothing.** The batch runner performs no authorization itself: every step calls
the same per-action entry point a single call uses, so target re-resolution, the plan envelope +
standing grants, coordinate confinement, the z-order hit-test and the password-control guard all
re-run per step. Three properties needed deliberate work to keep parity with N separate calls:

1. **The settle** (`input/foreground-settle.ts`). nut.js resolves a click when input is *sent*;
   Windows activates the window when its thread processes the message. Between separate calls the
   model round-trip WAS that settle — inside a batch the next step's focus probe could read the
   pre-click foreground (denying a legitimate action, or authorizing app A while keystrokes land in
   app B). After a focus-changing step (click/drag) the coordinate batch polls until two
   consecutive focus reads agree, bounded at 400ms. Timing out is not an error — authorization
   still runs and still fails closed.
2. **Atomic validation.** Every step is fully validated up front (`planDesktopAction` for
   coordinates, `actionRequiresValue` for elements), so a malformed batch runs *nothing* — with
   separate calls a bad call mutated nothing, and a half-run batch would strand the screen.
3. **The frame is the call's.** `app` is always read from the CALL, never from a step, so no step
   can redirect the coordinate frame it was authorized against.

The overlay renders a batch as ONE step naming its **first and last** actions ("Typing into
"Message" in Discord, then pressing "Send" in Discord") — the irreversible action is nearly always
last, and a bare "+N more" would hide exactly the step that matters most.

**Open (Kafi's call, natural Arc 2 company):** Stop-lever granularity. `interruptTurn` stops the
model loop, not an in-flight handler, so a 20-action batch is un-interruptible once started (every
action still authorized). Options: a `shouldStop()` predicate between steps, a lower cap, or both.

## Deliberately NOT in this arc

- Overlay active-control banner + live plan progress + all-modes reveal verification → Arc 2.
- `list_installed_apps` / `launch_app` → Arc 3.
- Input-method research note + `driving-the-desktop` notebook book → Arc 4.
- A settings toggle replacing the `VYNEL_DESKTOP_ACT_ENABLED` env flag (with the full
  isolated-machine acknowledgment) → future arc, flagged to Chad.
