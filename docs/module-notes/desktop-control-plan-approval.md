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

## Arc 2 — the overlay (SHIPPED)

**All-modes reveal VERIFIED in code, not assumed** (Kafi: *"the overlay while claude accessing
always need to opened on any mode auto/ask/bypass only diff is ask for permission or not"*). Step
publishing is unconditional per tool call — no mode or approval gates it — and both global-root turn
paths tap it, so a Telegram-driven turn lights the overlay exactly like a web one. In auto/bypass
there is simply no card; the first desktop step still reveals it.

**One real gap was found and closed:** a desktop tool called by a SUBAGENT emitted
`agent-tool-started` (nested under the Agent card, invisible to the overlay's fold) — a delegated
desktop task drove the machine behind a dark overlay. `activity-turn-steps.ts` now maps subagent
tool events into turn steps **for `mcp__desktop__*` only**: the overlay is a safety surface, so who
inside the turn drives the machine is irrelevant to whether the user sees it. That required
`toolName` on the `agent-tool-completed` frame (it carried none), so a consumer can settle a step
from that frame alone.

**Looking vs controlling.** The header distinguishes them — reading your screen and driving it are
very different things to have happening behind your back. `activePlan` is set only when a
`propose_desktop_plan` step settles **completed** (a denied card never runs the tool), and the panel
shows the approved goal + steps verbatim. The overlay deliberately never claims WHICH plan step is
current: nothing reports that, so a progress cursor would be invention.

**Desktop steps carry a larger input bound** (8KB vs the general 2KB). The overlay reads the plan
out of the step's `toolInput`; a maximum legal plan is ~6KB, so the general bound would silently
blank the safety surface on a big-but-valid plan — reading as "only looking" while an approved plan
ran.

**Double-card fix:** the main window's toast stack drops `mcp__desktop__*` cards inside the desktop
shell (the overlay owns them, parked over the app being driven); a plain browser has no overlay
window, so there they still render. The overlay also reveals on a pending desktop card even if the
fold missed the bell — an undecidable approval is far worse than a ghost panel.

**Known, accepted:** `onParentSettled` (subagent completion when the parent Agent call ends) emits
no wire events, so a subagent desktop step can spin "running" until `turn-ended`. It fails VISIBLE
(a stuck spinner pins the overlay open), never dark. A `display-only` envelope also flips the banner
to "controlling" though it authorizes nothing — the feed carries no consent mode; fixing it needs a
contract change.

## Arc 3 — installed apps + launch (SHIPPED)

Every other primitive in this package addresses a LIVE window, so "open Chrome and search YouTube"
dead-ended the moment Chrome wasn't already running. Two tools close that:

- **`list_installed_apps`** (read-only, ungated like `list_open_apps` — names grant nothing) via
  PowerShell `Get-StartApps`: one roster covering Win32 + packaged (UWP) apps, each with the AppID
  that can launch it, so what we list is exactly what we can start — no exe-path guessing. Optional
  `query` ranks exact → prefix → substring; results cap at 60 and the response SAYS when it
  truncated (silence would read as "not installed").
- **`launch_app`** — an ACTION, so it is plan-gated exactly like the act tools and authorized
  against the resolved app before anything starts. **Tier: `click`, not `read`** — "look only" is a
  promise to observe and not touch, and starting a program is touching. Launching goes through
  `shell:AppsFolder\<AppID>`, which addresses both app kinds identically; the id rides `execFile`'s
  ARGUMENT array (never interpolated into command text) and is validated against shell
  metacharacters first. Then it WAITS for a matching window and returns the window name to target —
  without that the model snapshots a window that doesn't exist yet and concludes the app failed.
  Ambiguity never guesses (launching the wrong program is a visible side effect the user must undo).

Window-appeared matching is a forgiving substring both ways (Start-menu "Google Chrome" vs window
"chrome.exe"); it only decides whether to keep WAITING and grants nothing — the exact-normalized-key
grant/plan check still runs on every act.

## Deliberately NOT in this arc
- `list_installed_apps` / `launch_app` → Arc 3.
- Input-method research note + `driving-the-desktop` notebook book → Arc 4.
- A settings toggle replacing the `VYNEL_DESKTOP_ACT_ENABLED` env flag (with the full
  isolated-machine acknowledgment) → future arc, flagged to Chad.
