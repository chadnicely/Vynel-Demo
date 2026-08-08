# Live tracking — worked example (my understanding, for Chad to correct)

Companion to `docs/live-tracking-redesign.md`. One continuous story under the NEW model.
Correct me by scene number or by the **Q#** assumptions at the bottom.

---

## Scene 0 — idle

Clean global thread. **No rail** — the right edge is empty because nothing is active.
No cards, no chips, no panel.

## Scene 1 — Global → Workspace (Case 1)

**9:41** You, in Global: *"Run July invoicing in the Invoices workspace."*

```
┌─ Global ────────────────────────────────────────────┬──┐
│ YOU  9:41                                           │ W│
│   Run July invoicing in the Invoices workspace.     │ O│
│                                                     │ R│
│ CLAUDE  9:41                                        │ K│
│   On it — handed July invoicing to Noah · Invoices. │ I│
│   He'll report back here when done.                 │ N│
│   ↳ July invoicing → Noah · Invoices        ← ptr   │ G│
│                                                     │  │
│                                                     │[IN]│ ← icon appears
│ [Ask Claude for anything…]                          │  │
└─────────────────────────────────────────────────────┴──┘
```

- The **pointer row** sits right under the hand-off message: `↳ <task> → <persona · workspace>`.
  No live card, no narration mirror, no chip — the pointer is the whole tracker.
- The **rail** grows one small icon `[IN]` (Invoices) because it is now active. Only active
  entities ever show; the rail was empty a second ago.

**Click behaviors:**

- **Click `[IN]` (the icon):** sidebar opens at the **latest** messages — Noah's real
  conversation, one unified flow (messages + tool chips inline, NO Activity/Chat tabs):

```
┌─ sidebar ───────────────────────────────┐
│ ● Invoices                          ✕  │
│   Noah · July invoicing · 0m 42s        │
│─────────────────────────────────────────│
│ CLAUDE · FROM GLOBAL  9:41              │
│   Run July invoicing …                  │   ← the task's start (the anchor row)
│ NOAH · INVOICES  9:42                   │
│   Picking up July invoicing now.        │
│   ● Read invoices/july-drafts.csv       │
│   ● Edited invoice-204.md  +2 −2        │
│─────────────────────────────────────────│
│ [Message Noah…]                         │
│ [Open session]                [Pause]   │
└─────────────────────────────────────────┘
```

- **Click the pointer in Global:** same sidebar, all messages loaded, but **scrolled to the
  anchor row** (highlight flash) — the row in Noah's thread that carries this task's
  `partialSessionId`. From there you can jump to latest, scroll, or type.
- **Typing in the sidebar** sends a normal message into Noah's conversation (queues if his turn
  is mid-run).

**9:44** Noah hits a step needing you: approve `lpr receipt.pdf`.

- Rail: `[IN•]` — the icon gains the **attention dot**.
- Sidebar (if open): banner at top — "Waiting on you — approve `lpr receipt.pdf`".

**9:45** You send a second task to the same workspace: *"Also chase the missing PO numbers."*

- Global thread: a second pointer row `↳ Chase missing POs → Noah · Invoices`.
- Rail: **still one `[IN•]` icon** — one icon per entity, not per task.
- The second task queues behind the first (same-workspace serialization). Its pointer opens the
  sidebar at latest until its turn starts (no anchor row exists yet — it self-heals the moment
  the turn begins).

## Scene 2 — Workspace → Session fan-out (Case 2)

**9:47** Noah judges July invoicing big, spawns a dedicated session and hands it off, ending
his own turn quickly (dispatcher pattern).

In **Noah's thread** (you see this in his sidebar):

```
NOAH · INVOICES  9:47
  This is a full run — handing it to a dedicated session.
  ↳ July invoicing → July run (session)        ← ptr, one level down
```

- Rail: `[JR]` (July run) appears **next to** `[IN•]`. Two icons, two active entities.
- **9:48** Noah's own turn ends → `[IN]` **disappears** while `[JR]` keeps working — icons
  leave one after another as each completes. (The queued second task now claims Noah, so `[IN]`
  may pop right back — honest.)
- Click the pointer inside Noah's sidebar → the **same sidebar navigates** to the session's
  conversation, anchored at its start; **Back** returns to Noah. Or click `[JR]` on the rail
  directly → the session at latest.

## Scene 3 — @mention a colleague (Case 3)

**a) Quick answer — no tracker felt.**

**9:50** You, in Global: *"@noah what's our invoice numbering rule?"*

- Your message lands **directly** in Noah's colleague session. In HIS thread it reads:

```
YOU · FROM GLOBAL  9:50
  what's our invoice numbering rule?
```

- Noah answers in seconds via send_message. In Global you get a **compact reply box**:

```
┌ NOAH · INVOICES  ·  Reply ──────────────┐
│ Invoice numbering rule                  │  ← short title
│ Sequential per month, INV-YYYYMM-NNN…   │  ← one-line description
└─────────────────────────── [click ⇒ popup with the full text]
```

- Tracker: **none felt.** The run settled in seconds, so its pointer/icon never really existed
  (trackers are in-flight-only — nobody classified "answer vs task").

**b) Real task via mention — same tracking as any task.**

**9:52** *"@noah reconcile June receipts against the bank export."*

- Pointer row appears under your mention: `↳ Reconcile June receipts → Noah · Invoices`.
- Rail: `[NO]` (Noah's colleague session) while he works; gone when he reports.
- His report arrives as the compact **title + description box; popup = full report**.
- From the rail you can open Noah's session and **type directly** — same process as mentioning
  (D7 confirmed). He keeps full context across all of this: same continuing session.
- Scope rule: mentioned at Global → his GLOBAL colleague session; mentioned inside Marketing →
  his Marketing colleague session (a different continuing session).

## Scene 4 — built-in ephemeral agent (one-time worker) — CORRECTED

During the July run, the session spawns a built-in Agent ("Check 12 PDFs in parallel").

- **Rail icon while it runs** — `[AG]` appears like everyone else, and leaves the moment it
  finishes. **A pointer shows where it was spawned.**
- **Click (icon or pointer) → sidebar shows ALL of its one-time activity.** No anchor
  navigation — there is no conversation to navigate; it shows everything. No composer — you
  don't message a one-time worker. The activity stays viewable **persistently** after
  completion via the pointer.
- The real difference from session-kind entities is not visibility — it's that **it does not
  talk** (see Scene 6): no ack, no progress messages, no report. It RETURNS its result to the
  turn that spawned it.

## Scene 5 — #ref (context pointer, no tracker)

In Marketing: *"Draft the pricing page — # Invoices: follow that workspace's numbering
pattern."* Pure read-only context reference. Nothing on the rail, no pointer row, no tracking —
it's not work being handed off.

## Scene 6 — completion cascade + refresh honesty

- **10:04** July run finishes → report box lands in Noah's thread, Noah relays up → report box
  in Global (title + description, popup) → `[JR]` leaves the rail.
- **10:06** The PO-chase finishes → its report box → `[IN]` leaves. Rail empty. Screen clean.
- **F5 at any point mid-work:** the rail and pointers rebuild from the DB (in-flight jobs +
  persisted rows) — pointers anchor to persisted rows by construction, so refresh can never
  blank the story.
- **Two completion styles, one rule (CORRECTED):** session-kind entities **TALK** — they
  received a message, they respond on progress (Update boxes) and respond after completing
  (Report box), all as messages in the requester's thread. Built-in agents **RETURN** — their
  result lands inside the spawning turn as the Agent tool's return value; nothing is
  "delivered" anywhere.

---

## What DIES under this model (my understanding)

Inline persona cards + the card rail · banner delegation chips · the acked-badge threadId
matching · narration mirroring into cards (B6's whole surface) · delegation↔turn pairing for
rendering · the Activity/Chat tab split · the Background overview panel's job (absorbed by rail
+ sidebars — pending your explicit call) · card cap + "+N more" overflow.

**What stays:** the feed (drives rail presence + attention dots + elapsed), the in-flight poll
(rail roster), the watched-turn registry (live edge inside sidebars), reports/updates delivery,
approvals, Stop/Pause, `partialSessionId` + threadId (now as anchors, not join keys).

---

## Q# — my assumptions (status after Chad's corrections, 2026-08-08)

Chad: "you got all" + three corrections (Scene 3 label, Scene 4, Scene 6 — applied above).
Uncorrected Q's below stand as the working defaults.

- **Q1** — Root-delegated task's anchor row in the target thread is attributed
  `CLAUDE · FROM GLOBAL` (Claude relayed your ask). Mentions are `YOU · FROM <scope>`.
  Standing unless corrected.
- **Q2** — The pointer is its OWN compact row right under the hand-off/mention message
  (`↳ task → target`), not a decoration on the message itself.
- **Q3** — A queued (not yet started) task's entity already shows its rail icon (in-flight =
  queued + working). Alternative: icon only once actually running.
- **Q4** — ✓ CONFIRMED by Chad: one icon per ENTITY no matter how many tasks; workspace shows
  its workspace icon, agents wear a small corner agent badge; the icon leaves only when the
  entity has NOTHING active left.
- **Q5** — Interim **Updates** render like reports: compact title + description box with popup,
  just badged Update.
- **Q6** — ✓ CORRECTED by Chad: ephemeral agents DO get a rail icon while running + a pointer;
  click → sidebar showing ALL their one-time activity (read-only, persistent). See Scene 4.
- **Q7** — Old monitor panel, Background overview, Home "Right now" band, and the title-bar
  presence button all RETIRE; at most a minimal title-bar dot stays as a pure "something is
  running" signal. (Direction implied, not yet your explicit call — **full explainer in the
  "Q7 explained" section below.**)
- **Q8** — Sidebar "Open session": for a workspace → jumps to the full workspace tab; for a
  session/colleague → opens it in the Sessions view.
- **Q9** — "Pause" = the existing Stop on the current run (job settles as stopped-by-you), not
  a new suspend/resume capability.

---

## Q7 explained — the four retire/keep calls

Q7 is really four separate surfaces. For each: what it does today, what the new model already
covers, what you'd genuinely lose, and my recommendation. Decide per item (Q7a–Q7d).

### Q7a — the Background overview panel (the roster)

- **Today:** the Claude-desktop-style list of everything running/queued — one ROW per task,
  grouped by persona, with narration, elapsed, origin note, Watch + Stop per row, durable seed.
- **New model covers:** the rail lists the same population as icons (one per ENTITY), click →
  the real conversation (richer than the roster's derived rows), Pause in the sidebar,
  attention dots. Rebuild-after-refresh comes from the same durable sources.
- **You'd lose:** the per-TASK glance. The roster showed "Invoices: 2 tasks — one working, one
  queued" without a click; the rail shows one [IN] icon. And row-level Stop without opening
  anything.
- **Recommendation: RETIRE.** Move the per-task glance INTO the sidebar: its header (or a thin
  strip under it) lists that entity's active tasks (label + queued/working + stop), which also
  answers the recorded "multi-task presentation in one sidebar" question. One click for detail
  is the whole philosophy of the pointer model.

### Q7b — the monitor panel itself (the overlay with trace / session / agent nodes)

- **Today:** the one overlay window: trace node (a delegation's derived entry list), session
  node (LiveSessionPane), agent node (AgentFocusView), stacked drills with Back.
- **New model covers:** everything, better — the sidebar IS the session view (Case 1), drills
  with Back (D4), and shows an ephemeral agent's full activity (corrected Scene 4). The trace
  node's job — "watch this delegation" — is replaced by opening the TARGET's real conversation
  via the pointer; a derived entry-list view of the same turn adds nothing the thread doesn't
  show.
- **You'd lose:** nothing functional I can find. The trace view was a workaround for not having
  a navigable real conversation; now we have one.
- **Recommendation: RETIRE the whole panel** (largest single deletion of the arc — the overlay,
  node stack, trace entries list, and the agent focus view all fold into the sidebar).

### Q7c — Home's "Right now" band

- **Today:** one card per running turn on the dashboard — persona, origin note, elapsed,
  narration line, click → owning surface, "See all" → roster.
- **New model covers:** the rail is app chrome — visible on Home too, same population, same
  click-through. The band becomes a duplicate rendered with exactly the machinery we're
  deleting (cards + narration mirroring).
- **You'd lose:** the narration line at a glance on the dashboard ("Read · invoice.pdf"), and
  a slightly warmer presentation for the "glance at my assistant" moment.
- **Recommendation: RETIRE the band; KEEP Home's one-line status text** ("2 working right now ·
  1 waiting on you"), derived from the same presence store — plain text, no cards, no
  narration machinery.

### Q7d — the title-bar presence button (dot + title, click → roster)

- **Today:** gold dot = something runs anywhere, amber = approvals waiting; clicking opens the
  Background overview.
- **New model covers:** the rail shows WHO is working better than a dot shows THAT something
  is; per-icon attention dots cover per-entity approvals.
- **You'd lose (if fully removed):** the one catch-all attention signal. Two things the rail
  does NOT cover: (1) approvals on YOUR OWN current turn (not a rail entity), (2) any signal
  at all when the rail is empty-but-something-needs-you.
- **Recommendation: KEEP THE DOT, RETIRE THE BUTTON.** The dot stays as a passive
  idle/live/attention summary (it is nearly free — it reads one store); its click no longer
  opens a panel — either no click target, or click = jump to the thing needing attention.

### One edge case the rail doesn't obviously cover — decide with Q7

**The global root's own background turns** (a Telegram reply, a schedule fire on the brain) —
today the origin strip above the composer covers this ("Replying on Telegram…"). Options:

- **(i) The global root rails like everything else** — everything is a session, so the brain
  gets an icon while a background turn runs on it; click → the global thread. Consistent, and
  visible from any workspace tab. My lean.
- **(ii) Keep the origin strip** for this one case only (smallest change, but keeps one
  card-era element alive).

### If you accept all recommendations, the final chrome is:

**The rail** (every active entity incl. the brain, attention dots) + **the sidebar** (real
conversations, pointers, per-task strip, composer, Pause) + **a passive title-bar dot** +
**Home's status line**. Everything else — roster panel, monitor overlay, trace view, agent
focus view, Home cards, banner chips, thread cards — deleted.

---

## Q7 by example — before / after (same morning, 10:15)

> **VERDICTS (Chad, 2026-08-08): all four accepted as shown, with ONE amendment — Q7a ships
> WITHOUT the per-task strip.** The sidebar is the regular conversation, nothing more: each
> task is visible as its pointer row in the flow (children push messages at natural breaks —
> after a tool completes — so the conversation IS realtime; the workspace absorbs context and
> processes when it needs). Multi-task glance = read the thread. Header stays persona ·
> current task · elapsed (from the mock). Edge case: accepted — the brain rails
> (recommendation i). Global pointer → scroll-to-partial already covers the tracking.
> **Home amendment (Chad): skip the Q7c status line too — Home is rebuilt later; this arc
> only deletes the band.**

Three things are active: Noah chasing POs, the July run session finishing, one approval
waiting on you. Each Q7 surface today vs under my recommendation — decide per item.

### Q7a — the roster panel → rail + per-task strip in the sidebar

TODAY (title-bar button → the Background overview panel):

```
┌─ Background activity ────────────────────┐
│ ● Noah · Invoices                        │
│    Chase missing POs      working · 12m  │
│    "Read · bank-export.csv"  [Watch][■]  │
│    July invoicing         queued         │
│ ● July run (session)      working · 28m  │
│    "Edited · invoice-207.md" [Watch][■]  │
└──────────────────────────────────────────┘
```

AFTER (no panel — the rail IS the roster; the sidebar carries the per-task glance):

```
rail:  [IN•]   ← Invoices (dot = approval waiting)
       [JR]    ← July run session

click [IN•] → sidebar:
┌─ sidebar ────────────────────────────────┐
│ ● Invoices — Noah                     ✕  │
│ ▸ Chase missing POs    working · 12m  ⏸ │   ← per-task strip
│ ▸ July invoicing       queued         ⏸ │     (label · state · stop)
│ ⚿ Waiting on you — approve lpr receipt   │
│──────────────────────────────────────────│
│ …Noah's real conversation…               │
│ [Message Noah…]                          │
└──────────────────────────────────────────┘
```

Same information, one click deep, no second overlay system. The strip answers the one thing
the rail alone can't: "which tasks does this entity hold right now."

### Q7b — the monitor overlay (trace drill) → pointers into real conversations

TODAY (Watch → an overlay showing a DERIVED entry list, not the real thread):

```
┌─ Invoices · Chase POs (trace) ───────────┐
│ ▶ thinking…                              │
│ ● Read  bank-export.csv         0.4s     │
│ ● Grep  "PO-2026"               0.2s     │
│ (reconstructed entries; Back pops a      │
│  panel node stack)                       │
└──────────────────────────────────────────┘
```

AFTER: this surface simply does not exist. The pointer opens Noah's REAL thread (the Scene 1
sidebar) scrolled to the task's anchor row — same tool chips, plus the words around them, plus
a composer. Deeper only via pointers (Scene 2), Back returns. One conversation renderer
everywhere; the derived view and its overlay stack are deleted.

### Q7c — Home's "Right now" band → one status line

TODAY:

```
┌─ Home ───────────────────────────────────┐
│ Right now                       [See all]│
│ ┌ Noah · Invoices ── 12m ┐ ┌ July run ─┐│
│ │ "Read · bank-export…"  │ │ 28m       ││
│ └────────────────────────┘ └───────────┘│
└──────────────────────────────────────────┘
```

AFTER:

```
┌─ Home ──────────────────────────────┬──┐
│ ● 2 working · 1 waiting on you      │[IN•]
│                                     │[JR]
│ …the rest of Home…                  │  │
└─────────────────────────────────────┴──┘
```

The rail (always present, every view) is the live surface; Home keeps one honest text line
from the same store. The card machinery goes.

### Q7d — title-bar button → passive dot

TODAY:  `[ ● Vynel — assistant working ]`  ← the pair is a BUTTON; click opens the roster.

AFTER:  `● Vynel`  — the dot stays (gold = working · amber = something waits on YOU · grey =
idle) but opens nothing; the rail is the detail. Why it survives at all: your OWN turn can hit
an approval while the rail is empty — the dot still turns amber.

### The edge case — the brain's own background turn

**10:22** — you're in the Marketing tab. A Telegram message arrives; the global root replies
in the background.

TODAY: nothing visible from Marketing (the origin strip lives only on the global thread).

AFTER (recommendation i — "everything is a session" includes the brain):

```
rail:  [CL]    ← the brain, replying on Telegram — visible from ANY tab
       [IN•]
       [JR]
```

Click `[CL]` → the Global thread. When you're already on Global, the turn streams inline
there as always.
