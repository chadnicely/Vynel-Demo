# Changelog

All notable changes to Vynel are recorded here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/); the fuller rebuild narrative (per-module notes, the
module-by-module move log) lives in `.claude/journal/` and `.claude/STATE.md`. Entries begin from the
`@vynel/session` keystone (2026-07-04).

## [Unreleased]

### Changed

- **Voice got faster: a lean, bare session that talks before it acts.** The spoken thread now
  runs on Haiku 4.5 (Sonnet 5 remains the only fallback when a long conversation needs the
  bigger window — nothing else ever runs a spoken turn), and it travels light: no computer-level
  Claude configuration is read, no native file/shell tools attach (Vynel's own tools are the
  whole surface), and the prompt is the spoken identity alone. The voice instruction was
  rewritten around one rule — say one short sentence about your request first, then do the work,
  then say the outcome — so you always hear something before the tools start.

### Fixed

- **A task sent by voice now reports back to the voice conversation.** Work the spoken thread
  asked for used to come back on the Global chat — the voice conversation never heard the result.
  The voice thread is now a first-class requester: its tasks record the spoken thread as the
  asker, every report — the child's own message, a final answer to you, the engine's stand-in
  report, a failure notice — arrives as a real turn on the voice conversation (its own queue lane,
  the voice tier, no forms), and the Global chat no longer narrates outcomes that belong to the
  spoken thread. Workspace children were verified unaffected — their reports still land on the
  workspace that asked.

## [0.3.8] — 2026-08-27

### Added

- **About Vynel.** The Vynel menu (and the command palette) gained About: the version this computer
  runs, and a **Check for updates** that asks right now instead of waiting for the update flow's
  four-hour timer. An update it finds downloads in the background and offers the same one-click
  restart as the pill. The answers are honest — "You're up to date.", "Couldn't check for updates —
  try again." when the network is down, and a build without an updater says so.

- **Setup connects a brain and offers a safe copy on GitHub, then celebrates.** Chad's two
  Welcome-prototype screens, built for real against the existing sign-ins: **Connect a brain**
  reads whether Claude is signed in on this computer (Codex and Kimi are shown as "Not yet" and
  refused by the contract), **A safe copy on GitHub** reads the `gh` sign-in and can be skipped
  ("Vynel will offer it again the first time it matters") — the CLIs keep their own credentials,
  Vynel never sees a token. Setup ends on congratulations with fireworks behind the card, then the
  ONE place "something new, or something you already have?" is asked; the answer opens the build
  wizard or the folder picker. **Help Vynel know you** is back: its answers become your
  assistant's first memory, at the user level (no project exists yet), so they follow you into
  every project.

- **"Which project?" — bring in a project through your computer's own folder window.** Pull
  from a folder (the "+" door, or "Something I already have" after setup) now shows one
  **Choose folder…** button that opens the operating system's folder dialog; Vynel then looks
  inside and answers — it IS a project (**Found it**), it HOLDS several (**Which of these?** — tick
  which, "Add 3 projects"), or nothing recognisable ("add it anyway"). Adding several at once is
  real: one failure names itself and the rest still go in; a single project opens its room,
  several stay quietly in the sidebar. Nothing is ever moved. Chad's screen (2026-08-24); the
  in-app folder browser stays in the codebase for the other pickers.

- **The sidebar sorts your projects for you.** Two sections: **Active Projects** — running, waiting
  on you, or stuck — and **Not running**, everything idle or done. A group is never split across
  the two; it follows its liveliest member, and an empty group stays under Active. Each section
  folds on its heading. The menu groups (Toolkit, Utils, Context, Connections) start folded on a
  fresh install and remember what you open.

- **The work rail has a kill switch.** A red **ABORT** at the top stops this room's work at once —
  no confirm, other rooms keep going; it is greyed, never hidden, while nothing runs. The live card
  headlines the task ("Task 2 · building now"), stays lit while that task is unresolved, and
  shows what you typed while it worked. **All Tasks** is one list: finished work floats to the top,
  struck, then the live task, then the queue — each keeping its number.

- **A mode change reaches the turn already running, and Stop bites at once.** Switching to Ask
  cards the very next tool call instead of the next turn; picking a mode inside a chat also makes
  it the default for new ones. Stop sends the engine's own interrupt before tearing the turn down,
  so it lands inside a long command instead of waiting for it to finish.

- **A queued message survives changing rooms.** What you queue while a room is busy waits for that
  room — switching tabs no longer loses it — and sends when you come back and the room is idle.

- **A working turn folds to one line.** While Vynel works — on your own question, or in a room on
  its own (a delivered report, the workspace manager, a schedule) — the live turn shows as ONE line
  naming what it is doing right now, rewriting itself as it goes. A click opens it any time, it
  opens by itself the moment it finishes, and a card waiting for your approval is never hidden.
  Five tool calls no longer stack into five boxes.

- **"What are we adding?"** — the "+" door asks two short questions: something new (the build
  wizard), or something you already have — and only then where it is (a folder, or a repository to
  clone).

- **Write your own rules, commands and skills — and let Claude write them too.** The Rules,
  Commands and Skills shelves (global menu and each workspace) now create, edit and delete: a rule
  is a standing instruction Claude follows in every conversation at that scope; a command is a
  reusable prompt you run as `/its-name` (with a description and an optional argument hint — the
  `/` menu shows it); a skill is a folder Claude opens when a task matches its description, with a
  file editor for its instructions and any reference files. Editing a Marketplace rule makes it
  your own copy. Claude gets the same doors as tools (`write_rule`, `write_command`,
  `create_skill`, `write_skill_file`, …) on the global chat and workspace conversations — deleting
  anything, or writing a rule, asks first in ask mode.
- **Build and edit agents from the shelf.** The Agents shelf can build a specialist (name,
  when to use it, instructions, optional tools and model), edit or delete one, and add from the
  curated catalog — doors Claude already had through chat. Every agent you build is now also
  written as a file under `.claude/agents`, so plain Claude Code sessions see it too. Subagent
  files you wrote by hand are listed beside them ("On disk") and can be edited or removed; Claude
  can list, write and delete those files as well (`list_agent_files`, `write_agent_file`,
  `delete_agent_file`).
- **Skills you add by hand show up.** A skill folder dropped into `.claude/skills` appears on the
  shelf the next time you open it, chipped "On disk"; one you removed reads "Needs attention".
  The Commands row in the menu now shows a count.


- **Sessions wear their icon in the chat.** A reply or report delivered by a child session shows
  the session's curated icon in its author line instead of two-letter initials. Notices Vynel
  itself writes (a background task it relayed for, the task list, a schedule, a monitor) each
  wear their own icon, with one fallback for anything else.

- **File paths are clickable, screenshots are visible.** The file name on a Read/Write/Edit
  card, the path in its expanded header, and any file path written in a message (yours or the
  assistant's) open the file in its workspace's editor. A tool that returns a picture — a
  desktop screenshot, an image file the assistant read — shows the picture on its card, small
  when folded and full-size with its caption when expanded.

- **Finish setting up — a project you bring in tells you what it needs.** A project pulled in from
  a folder starts under a new **Needs setup** section at the top of the sidebar; clicking it opens
  "Finish setting up", which reads the folder and shows what it found — its git repository, the
  `.env` (the KEY NAMES only, never the values), the database its dependencies imply — and the one
  thing a folder cannot answer, which of your connected accounts builds. Nothing in the folder is
  touched; **Done — start building** stamps it set up and it leaves that section. Pull in several
  at once and they wait quietly in Needs setup rather than marching you through setup screens back
  to back. A project Vynel builds for you (the wizard, a clone) is set up from birth.

- **The wizard opens on the idea and names the project last.** "Start something new" now opens on
  what you want to build and asks for a name only near the end; Vynel makes the folder for it —
  you never pick one or move anything.

### Changed

- **Setup is five steps.** Welcome (Chad's copy: "Your projects stay where they are" first) →
  Your profile → Help Vynel know you → Connect a brain → A safe copy on GitHub. No "Name your
  workspace" step (Kafi, 2026-08-27): setup creates no folder and no workspace — the question at
  the finish line does. While setup runs, the engine lets through only the sign-in reads and
  handshakes those two screens need; everything else stays behind the first-launch gate.

### Fixed

- **Adding a project can no longer freeze the engine.** Creating the project's hidden metadata
  folder now happens off the engine's main thread and outside the database transaction (a security
  filter stalling that write once froze every room for minutes), and a refused add takes the folder
  back — yours is left exactly as it was found.
- **`pnpm test` could not run from a checkout path containing a space.** Three parity checks
  spawned a helper through `shell: true` without quoting the path; every such site now shares one
  quoting rule (`scripts/src/quote-for-shell.ts`).
- **A persistent dialog no longer dismisses itself when the system folder window opens** — the
  native window moves focus off the page with no click and no key, which read as "clicked outside".

- Uninstalling a skill that was discovered on disk removed its record but left the folder when the
  folder's name differed from the skill's name; the folder recorded at install time is used now.
- A hand-made skill whose name matched a Marketplace item made the Marketplace card read
  "Installed" — and its Uninstall would have deleted the hand-made folder. Only skills that came
  from the catalog count.
- A rule file with a name the editor could not address (spaces, accents) was listed but could not
  be opened for editing; the list and the editor now agree on what a valid name is, and names with
  characters Windows forbids (`: < > " | ? *`) are refused instead of silently writing nothing.


- **A workspace shows "working" while any of its sessions works.** A task sent to a session that
  lives in a workspace (by `send_message`) used to run as if it belonged to the global area, so
  the workspace's row, tab, sidebar card, and node all read idle while its child was busy. The
  run now announces itself in the workspace the session belongs to.

- **The Global row ends with its state like every other row.** It showed nothing while parked or
  after a problem; it now wears the same play glyph and status dots the workspace rows wear.

- **Agent runs open from the thread while they run.** Clicking a running agent's card on an
  ongoing conversation did nothing (the card had no session to open); it now opens the agent's
  panel, which also shows the instruction the agent was given and, once done, its result. The
  agent's card is the pointer card alone — no duplicate tool chip beside it.


## [0.3.7] — 2026-08-26

### Fixed

- **Voice model downloads work on every Windows machine now.** Downloading a voice (Kokoro,
  Piper, or a hearing model) could fail with a `bzip2` error on machines where Windows' built-in
  archive tool ships without bzip2 support — our dev machines had extra tools installed that
  masked it. The unpacking no longer depends on that: the compressed layer is handled inside
  Vynel itself.

### Added

- **Bring your own voice.** Settings → Voice can now connect your ElevenLabs or Google Cloud
  account with an API key — verified before anything is saved, encrypted on this computer, and
  never shown again. Once connected, either can do the speaking (pick any voice from your
  account, with Preview) or the hearing (transcribe what you say to a Vynel window). Web speech
  recognition stays the default for hearing, the wake word is always caught on this computer —
  the room's audio never streams to a cloud service — and if a cloud voice ever fails
  mid-sentence, the local voice finishes the reply so nothing goes silent.

- **The journal is now a clickable timeline.** Every entry the assistant writes carries who wrote
  it — the working session's name as a chip you can click to open that conversation in the sidebar
  and see exactly what was done — and, when the work landed as a commit, the commit's short id.
  The assistant is told to journal the moments that matter (started a task, finished it, a fix, a
  check that passed) with the commit attached, and the attribution happens automatically — it
  cannot forget it or write history as someone else.

- **The workspace has an operating model now.** The workspace manager's standing instructions
  teach the flow: the manager stays with you and runs the work through dedicated child sessions —
  one per area ("Email Feature Manager"), each task sent with clear instructions and tracked on
  the task list. Children build in their own worktree, never directly on the main branch; on a
  substantial task they plan, lay out steps, build test-first, and have the result checked by a
  fresh reviewer with no context before reporting done — and the manager itself merges the
  finished worktree and removes it. Small asks skip the ceremony.

- **Tool activity now folds tidy.** While the assistant works, each step reads as one short line in
  plain words ("Checking git status for you") with everything it did folded beneath it into a single
  summary line — "Ran 4 commands, edited pricing.ts +49 -20" — that you can expand to see every
  call, in every session view. Runs that used to scatter into many "1 tool call" rows now gather
  under their step line as one batch, live exactly as they settle. A live step shows what is running
  right now beside the summary, and a call that needs your go-ahead ("Run it anyway") opens its fold
  by itself. The assistant's standing instructions teach the matching narration shape — one short
  line per step, no chatter between tool calls — so transcripts read that way from now on.

- **Every session now starts from the same playbook.** The assistant's standing instructions became
  one editable stack: a shared **base** every session carries (how to behave, how to format
  replies), a **voice base** that replaces it on spoken turns (written for the ear, so a voice
  reply is never handed prose rules it has to un-learn), and one small **kind** file per session
  kind saying what that session *is* — the global brain, a workspace's **manager**, a **child**
  session opened for one assignment, or a named agent colleague. Child and background turns, which
  previously ran with no identity at all, now carry the same identity as the conversation's
  interactive turns; the workspace primary is named what it is — the manager, which works the
  project itself, hands slices to children with clear instructions, and owns what reaches the
  user. All of it is markdown under `packages/instructions/session-instructions/` — edit a file,
  restart, and the behavior follows.

- **Sessions wear a face now.** When Claude spawns a helper session ("Email Feature Manager",
  "Bug Hunt", …) it can stamp it with an icon from a curated set of thirty (mail, code, bug,
  chart, rocket…), picked to say what the session is *for*. The icon rides the session
  everywhere it is listed and survives long-conversation handoffs; a session without one wears
  its name's monogram over its accent, the same way workspaces do.

- **Phases and Features joined the workspace menu.** Two new sections in the Utils group, sitting
  directly above Plans and Tasks: **Phases** — the build plan's ordered stages, with ordinal
  chips and the same open → in-progress → done cycle the tasks use — and **Features** — what the
  project is building, grouped under its phase (unplaced ones gathered at the end). Both are
  view, edit, delete, and create through a dialog (their descriptions are long-form). On menus
  arranged before this release the two slot in at exactly that spot rather than dangling at the
  bottom of the list.

### Fixed

- **Talking directly to an agent colleague now brings its persona along.** A colleague's persona
  prompt used to ride only the tasks routed to it — opening its conversation and typing at it
  directly ran the turn with no persona (and no identity) at all. Direct turns into child sessions
  and colleagues now carry the same identity stack as their routed turns, the colleague's persona
  included; a colleague whose agent was uninstalled falls back to the plain child identity instead
  of failing the turn.

- **A room no longer loses its conversation if the engine dies mid-first-turn.** The link from a
  room (or the global assistant, or the voice thread) to the session its first turn started was
  only written after the turn finished — so a crash or a restart during that first turn left the
  whole conversation stranded: the room showed its welcome screen over an orphaned thread, and a
  stray "New session" row appeared in its Sessions list. The link (and the hiding of that first
  segment) now happens the moment the session is known, and again at the end as before.

- **`pnpm test` no longer restarts a running dev engine.** The code generators the gate re-runs
  rewrote their output files even when nothing changed, and the engine's file watcher restarted
  on every rewrite — mid-turn. They now write only when the content differs.

- **The task panel's sessions box no longer misses a working helper.** A helper the assistant
  sent work to through the delegation queue announced on the wire under the global family, so
  the box filtered it out and said "0 sessions working" while it visibly worked. The box now
  places every live turn by the session it belongs to — the one truth — whichever door the turn
  came through.

### Changed

- **Sessions open from the sidebar now — the extra list panel is gone.** Click Sessions in a
  room's menu and the left column becomes that room's conversations, the same way the tree
  drills into a room's menus: a back row on top ("← letterman") returns to the menus, the rows
  wear the tree-row look, and the one you pick opens straight in the main pane. The open
  conversation rides the address (`?session=…`), so a reload lands where you were, and an
  earlier part of a continued conversation opens view-only from its chain.

- **The Nodes screen tells the truth about the centre.** Out on the fleet, the centre orb IS
  the global primary session: it wears its live status (ring colour, faster spin while
  working), clicking it opens the global chat, and the spoken Voice thread rides beside it as a
  small moon on the first orbit — its own status, its own click into Voice chat. Inside a
  project, the old "The build" satellite is gone: the centre is the workspace manager itself —
  the primary session — wearing the room's status, one click from its chat, with only the
  child sessions in orbit. And project dots now wear the workspace's own uploaded face, the
  same one the sidebar tree shows.

- **The Sessions list speaks the left menu's language.** Session rows now look like the workspace
  rows in the sidebar tree: the session's icon (or monogram) on the left, the name, and the state
  cluster on the right — relative time, context %, a spinner while it works, the status dot when
  it needs you. The one-line why and "continued N×" sit under the row as quiet footnotes.

- **The task panel's "sessions working" box shows the workspace's helpers, not the room itself.**
  It now counts and lists only the *child* sessions working for that workspace — each with its
  name and icon in the same tree-row style — and clicking one still opens its real conversation
  in the sidebar. The room's own thread was never a helper: it already owns the live card above.

### Removed

- **The WORKING edge strip is gone.** The little vertical rail of icons on the right edge
  duplicated what the task panel's sessions box now does properly, so it retired. Everything it
  opened is still one click away: the sessions box rows and chat pointers open the same sidebar.

- **First launch is two screens now: hello, and your name.** The old setup walked through seven
  steps — naming a workspace, seeding memory, picking starter skills, connecting Telegram,
  scheduling a briefing. All of that has a better home inside the app today (the new-workspace
  wizard, Skills, Channels, Schedules), so onboarding stopped front-loading it: welcome, your
  name, and you're in. A setup that was left half-finished on the old flow starts over cleanly
  on the new one.

## [0.3.6] — 2026-08-24

### Added

- **A GitHub repository when you finish the wizard — and "Connect to GitHub" for any workspace.**
  When the app is signed in to GitHub, the wizard's account step offers "Also create the
  repository on GitHub when I finish" with the name (following the workspace name) and
  private/public; Finish then makes the repository and pushes the first commit through the
  GitHub CLI, and the Done screen links to it — or says plainly why it could not (name taken,
  not signed in…), the workspace being fine either way. A workspace that already exists and has
  no remote shows **Connect to GitHub** in its header: the same create-and-push, the same two
  fields; signed out, it points to Settings → GitHub instead of a dead button. Vynel never
  touches the token — `gh` does the API call and the push.

- **The workspace header says where git stands.** Beside the workspace name: the branch, how much
  is uncommitted, and how far ahead/behind its upstream ("main · 3 uncommitted · ↑1 ↓2"), with the
  remote, the tracked branch and the worktree count on hover. A folder without git says "No git
  yet"; a vanished folder or a machine without git says so in the danger hue — never a broken
  header. Read fresh from git every half minute, so work the sessions do on Bash shows up without
  Vynel being told. A session can read the same facts with the new `get_workspace_git_facts`
  tool (branch, distance, changed/untracked counts, origin, local branches, every worktree —
  the `.claude/worktrees/<slug>` ones included) before deciding where to work.

### Changed

- Vynel's own few git calls (the wizard's first commit, the repository door's clone, the new
  facts reader) now run through ONE runner with `protocol.ext.allow=never` on every call and
  `--no-optional-locks` so a background read never fights a session over the index lock.

- **Signing in to Claude finishes by itself.** "Sign in with your subscription" opens your browser;
  once you click Authorize there, Vynel notices on its own and shows the account — no code to copy
  back. The link + paste-a-code path is still there, folded behind "Browser didn't open, or a
  different account?" (open the link in a private window to sign in as an account your browser
  isn't holding). Vynel still never sees the credential — Claude's own program writes it.

### Fixed

- **A fresh computer no longer says "Claude Code isn't installed."** Vynel ships its own Claude
  engine, but the account dialog and the wizard's account step were looking for a separately
  installed `claude` on the machine — so a clean install had nothing to sign in to. Every Claude
  door (status, sign-in, plugins, MCP) now runs the one bundled engine; "not installed" is now
  only ever a torn Vynel install, and says to reinstall.
- The sign-in link was being captured with its terminal hyperlink escape codes glued in (the
  current Claude CLI paints it as a clickable link), producing a doubled, broken URL — fixed for
  both the local sign-in and the server sign-in.
- Reading the Claude account status no longer freezes the engine for up to five seconds — the
  synchronous "is claude installed" probe is gone (the bundled engine's presence is a file check).

### Removed

- **The steps strip under the chat is retired.** The task panel's tasks + steps are the one place
  the assistant keeps its visible work list, so the little step dock above the composer is gone
  and sessions no longer get the tool that fed it. Nothing is deleted underneath — the dock's
  plumbing stays for a deliberate return.

## [0.3.5] — 2026-08-23

### Added

- **Settings → GitHub: one sign-in for the whole app.** Vynel now talks to GitHub through GitHub's
  own command-line tool (`gh`), the same one your sessions use. If it isn't installed, the screen
  says so and how to get it; if it is, you sign in from inside Vynel — a one-time code and a link,
  approved in your browser — and Vynel notices the moment it lands. The credential stays with
  `gh`; Vynel never sees it. The new-workspace wizard's account step shows the signed-in handle.
- **New workspace now opens a door, and one of the doors is a guided setup.** Adding a
  workspace asks one question first — start something new, or bring in what you have. "Pull
  from a folder" is the dialog you know. "Walk me through it" is new: twelve short screens
  that take an idea to an approved plan. You pick the folder that will be the workspace first
  (your own folder, wherever you like — New folder makes an empty one; nothing gets moved, and
  the folder names the workspace until you do), describe the idea in your own words,
  answer five quick questions, optionally name a website like it (Vynel lists what that
  site does from what it already knows — it says so plainly — and you tick what you want),
  read the plan and score it out of ten until it is right, approve the MVP and the build
  sessions, and Finish. Finish puts a README with the stack and a first commit in your folder
  (never overwriting anything already there) and makes the workspace itself — and keeps the plan you approved with the workspace, where a
  later session can read it back. "Open my workspace" opens its chat with the brief already
  typed in; you press send, so building starts under your eyes, never on its own. The
  account step just checks you are signed in to Claude — accounts belong to Vynel as a
  whole, not to one workspace.
- **A workspace can be created from a repository.** The third door: paste a git address
  (https or ssh), pick the empty folder it should be cloned into (New folder makes one), name
  it, and Vynel clones it there and opens it as a workspace. If the clone fails, you see git's
  own reason and can try again — nothing you already have is touched.
- **Desktop control is a switch in Settings.** Settings → Desktop control lets you allow Vynel
  to do things on your desktop, not just look: act in apps (click, type, keys), open apps and
  links, arrange windows and volume, and read or write your clipboard. Screenshots and window
  lists are always allowed; everything else is off until you turn it on, every action is
  logged, and the change takes effect from the next turn. No more editing an environment file.
- **Vynel can bring a window to the front.** There was no way to ask for this before —
  windows only ever came forward as a side effect of Vynel reading or clicking something,
  so "put Discord in front of me" was not a thing it could do. Now it is. If an app has
  several windows open — three Chrome windows, two Explorer windows — you can say which
  one, and Vynel tells you which it raised and what the alternatives were, so a wrong
  guess takes one word to correct. Bringing a window forward never resizes it: a
  minimized window comes back exactly the size it was, and a maximized one stays
  maximized.

### Fixed

- **Talking in the Display no longer wakes Vynel underneath you.** While you speak to the app (or the
  dock), the background listener stands down, so your words — and Vynel's own replies through the
  speakers — are heard once, by the web recognizer. If no speaking voice is downloaded yet, the
  room says so instead of playing silence.
- **Apps now come to the front reliably, instead of sometimes.** Discord (and any app
  like it) would come forward on one request and stay stubbornly behind on the next, with
  nothing different about the request — it depended on invisible state left behind by
  Vynel's own earlier actions. Both routes now bring the window forward, so the same ask
  gets the same result.
- **Vynel targets the right window when an app has several.** It used to address a whole
  program rather than a window, so with three Chrome windows open it could act on
  whichever one the system happened to name first — and it could not see apps tucked in
  the system tray at all.
- **Bringing a window forward is much faster** — roughly a second of waiting per attempt
  is gone.

## [0.3.4] — 2026-08-22

### Added

- **Voice ships in the desktop app.** The installed app now starts Vynel's voice alongside
  the engine — no dev checkout, no separate command. A fresh install has no voice yet:
  Settings → Voice shows the speaking and hearing models, and the moment a download lands
  the voice comes alive by itself (the Voice screen says so), no restart needed. Until
  then the Display's microphone stays off and a preview answers "no voice model is
  installed yet" instead of failing. Adds about 22 MB to the installer (the speech
  engine's native pieces); call cables are not part of the installer.
- **Settings → Embedding and Settings → Voice.** A Settings menu in the top bar (between
  Vynel and View) now holds this computer's screens — Embedding, Voice, Where Vynel runs,
  Application — starting with the models that run on this computer. Embedding shows the search model behind
  memory and knowledge — downloaded or not, with a Download button and a progress bar —
  and Voice shows every speaking and hearing model the same way, lets you pick which
  installed voice Vynel speaks with (and which of Kokoro's eleven speakers) and which
  model it hears with. Downloads run in the background and stay where they land;
  Remove never takes the last voice in use.
- **A view switch in the top bar, and a full view.** Three icons just before the Claude
  mark — Nodes, Display, Normal — take you between the project constellation, the orb
  room and the everyday chat. Nodes and the Display open in **full view**: menus and
  sidebar step out, the view fills the window, and only the switch and the window
  controls stay in the corner; Normal brings everything back exactly as it was. The Display segment is the voice switch now
  (it opens the room and the microphone together; pressed again in the room it closes
  both); the Broadcast glyph and the `Nodes` word in the menu bar are gone. Normal view
  is exactly what it always was.

- **The Display follows you.** When you leave the Display mid-conversation, a small
  display dock appears bottom-right (above the desktop-control window when that one is
  showing) with the orb, the last line and the mic; it hides again when you return. Saying
  the wake word now opens the app on the Display, and the orb mirrors the conversation
  whichever side it runs on. Claude can place small widgets on the dock too.
- **Claude can put things on the Display.** Ask for a report, a table, a number, or a
  chart and it appears on the Display while Claude is still talking — and stays there
  after restart until you or Claude clear it. Four kinds (text, table, metric, chart),
  drawn by Vynel itself so nothing Claude writes can run as code. Up to 12 per board;
  the oldest makes room. Works from the global chat, a workspace chat, voice, and channels.
- **The Display.** A new full-screen view, one click in the top bar: Vynel's orb in the
  middle — breathing while idle, lit while listening, pulsing with every spoken phrase —
  with live status panels around it (what's running, what needs you, account, telemetry)
  and the microphone open the moment it opens. Closing it hands the mic back. Widgets that
  Claude can place on it come next.
- **"Remind me for tea at 5" typed in chat now creates a real schedule.** Claude can
  create, update, enable and disable schedules from the global chat, a workspace chat,
  or a channel — they survive restarts and show up in the Schedules panel, instead of
  Claude improvising a timer that dies with the app.
- **When Claude's own safety check blocks a tool in auto mode, the card says so and lets you
  run it anyway.** The blocked call reads "Blocked by Claude's safety check" with the
  reason, and one button posts your go-ahead as a message in the same conversation so the
  retry carries your intent. View-only threads show why the button is off.
- **Voice talks as it thinks.** Vynel now speaks the first sentence of its answer
  the moment it is written — while it is still working out the rest — instead of
  waiting to call a speaking tool after its work, and it never opens with a stock
  "let me check" or "one moment": what you hear first is its real first sentence
  about your request.
- **Talk over it.** While Vynel is speaking you can just start talking: it stops
  mid-sentence, listens, and answers the new thing — on the floating Jarvis
  overlay and on the native voice daemon (which now filters out the echo of its
  own voice instead of closing the mic). Closing or muting the overlay stops the
  answer for good.
- **Typed Voice chat is spoken per sentence** in the window, with a Stop button
  for a running spoken turn.
- **Autopilot.** The composer's Auto-buildout toggle now means something: when it
  is on, the assistant is told the user is probably away and keeps working on
  its own — making best-fit calls, researching with spawned agents when a
  decision needs grounding, and setting the session to "needs input" only when
  it is truly stuck. Spawned sessions inherit it.
- **Every wait now has a bound.** A delegated task holds its session for its
  whole run and is stopped honestly at a hard cap (60 min by default); an
  interactive turn is interrupted with a visible failure at its own wall clock;
  an unanswered question in chat expires after two hours; the voice daemon says
  "still working — I'll tell you when it's done" after five minutes instead of
  going deaf. All bounds are env-tunable and pause while you are deciding on a
  card.
- **Checkpoints survive a restart.** A task the assistant checkpointed before
  the app restarted continues afterwards instead of silently stopping; when a
  checkpoint cannot be continued (you stopped the turn, it failed, the cap hit)
  a short note on the thread says so and how to pick it up.
- **Voice chat shows its status.** The Voice chat menu row wears its own mark
  (running / needs input / problem), and the global light includes the voice
  thread.
- **Stop reaches the right thread.** Stopping a voice turn stops the voice
  turn, never the global conversation running beside it (the desktop overlay's
  Stop follows the same rule).
- **Voice now has its own conversation.** Speaking to Vynel no longer runs on the
  global chat thread: voice turns live on their own continuing spoken thread —
  same brain, same tools, separate context — so a very full global conversation
  can never break voice again, and a long global turn no longer blocks speech
  (or vice versa). It is walled like the global conversation: no other session
  can search or read it.
- **A "Voice chat" menu under Global.** The spoken thread now has its own
  window, right under Chat in the Global menu: read what was said, watch a
  spoken turn stream in live, and type into the voice conversation — typed
  replies are spoken aloud while the voice daemon is running, and always land
  in the thread as text.
- **Sessions can hand the global assistant a note.** `send_message` accepts
  `to: "global"` with kind "note" — plain communication delivered into the
  global conversation (tasks cannot target it). The voice thread signs its
  notes "Voice".

### Changed

- Settings → Voice now says who hears you: the local hearing models catch the wake word and open
  the window; from then on web speech recognition hears you.
- The wake window is now the **display dock** everywhere (window, route, settings
  `VYNEL_VOICE_DOCK_*` — the old `VYNEL_VOICE_JARVIS_*` names still work for one release).
- **The workspace tree is what you open into.** The app now starts in Menu view —
  the sidebar's workspace tree — instead of the tab strip. If you had already
  picked Tabs, you keep Tabs.
- **The Tabs/Menu switch moved into the View menu**, above "Show navigation", and
  off the title bar's right side. Both views stay named, with a tick on the live one.
- **The workspace tree reads as a tree.** A group's members now hang off a vertical
  guide line instead of sitting under a rule drawn across the group's name.
- **Claude knows what time it is.** Every typed or spoken turn now carries the current
  local time in your timezone, so "in 15 minutes" is computed from the right clock.
- **Run-now on a schedule waits its turn** behind other running schedules instead of
  bypassing the limit; a schedule already queued or running answers "already running".
- A spoken turn in the browser that ends with nothing to say now says so, like the native voice.
- Claude engine SDK updated to 0.3.235 (auto-mode permission classifier changes upstream).
- **Auto is the default mode everywhere.** A conversation nobody configured
  runs in Auto (Claude's own safety check still applies) — global, workspace,
  spawned sessions, channels and background deliveries all resolve the same
  default; sessions you explicitly set to Ask or Bypass keep it. Children of a
  session inherit its mode, model and effort at birth; a delegated task can
  still name its own.
- **Voice never shows a card.** Every voice leg — the wake word, a live call,
  the overlay, typing in Voice chat — runs the spoken tier (Sonnet 5, low
  effort, Auto). The Voice chat composer's chips are read-only "hands-free"
  chips and no longer write settings to the voice thread.
- **The delegated-task budget stops waiting, not working.** The old 10-minute
  "stop waiting" budget that let a long task keep running while its slot and
  lock were handed to the next job is gone: a task keeps its lock until it
  finishes or hits the cap.
- **The Nodes screen reads exactly the same but is built to grow.** Levels are a
  stack, node identity is typed, dots keep their place when the list reorders,
  layouts stay on stage past a dozen nodes, and a project's dots come from a
  scoped read (a busy account no longer loses project sessions).
- **Typing in Voice chat defaults to the voice tier too.** The panel's
  composer now starts on the same fast spoken-tier model the wake word uses,
  instead of the chat default — one thread, one tier, however you reach it.
  Picking a different model in the panel still sticks.
- **Voice answers on a stronger, still-fast model.** Voice turns moved from the
  small 200k-window model to Claude Sonnet 5 at low thinking effort — quick to
  speak, capable enough to route real work, and with a context window that can
  hold a long spoken thread.

### Fixed

- **A workspace's logo shows everywhere, not just in the tree.** The drilled sidebar
  card, the workspace's own replies in chat (including a manager speaking in its own
  room) and the workspace chip beside a named manager now wear the uploaded logo as-is —
  no tint behind it — instead of falling back to the two-letter monogram. A persona icon
  set on purpose still wins.
- **Every task in progress shows its current step.** In the tasks panel each running
  task carries its own live step line under the row, not just the first one.
- **Delete a task from the tasks panel.** Hover a row and a trash appears just before the
  expand caret; one click arms it, a second deletes.
- **The tasks panel belongs to the chat.** It opens beside the chat by default and stays
  off every other screen (sections, files, the Display); its toggles only appear where
  it can show.
- **The embedding model could never download inside the engine.** Memory and knowledge
  search-by-meaning silently stayed off on a fresh install because the model's own
  downloader never wrote the weights to disk from within Vynel's server process. Vynel
  now fetches the model itself (the same files, the same place), starts that download
  the first time something needs it — visible in Settings → Embedding — and says
  plainly when the model is missing instead of waiting two minutes.
- **A Telegram channel added to a workspace now talks to that workspace**, not to the global
  conversation — messages run on the workspace's own thread and replies come from there.
- **Tasks started from a channel report back properly.** The worker reports to whoever asked
  (Vynel writes the report itself if the worker forgets), the requester decides what to say,
  and the requester answers the channel — instead of a shortcut summary sent behind its back.
- **A channel turn never ends in silence**: if Vynel couldn't act (a safety block, an approval
  that timed out) or only had text, one honest line still reaches the channel.
- **Adding a Display widget no longer fails on the first try** — Claude now sees the real
  shape of a widget's content (and a pasted JSON string is accepted too).
- **A missed schedule now tells you.** If Vynel was not running when a schedule was due
  (and catch-up is off), the conversation gets a quiet "Schedule · <name> missed its run"
  notice with the next run time — and the channel message too when one is configured.
- **A plain reminder set to chat now shows up in the chat** as a "Schedule · <name>"
  notice instead of vanishing; chat-and-channel reminders land in both places.
- **Work interrupted by a restart is no longer forgotten.** When Claude had saved a
  checkpoint before the app restarted, the conversation now shows it at startup, Claude
  picks it up on your next message, and a newer checkpoint never silently erases it.
  The checkpoint tool also tells Claude honestly which conversations resume on their own.
- **A voice answer that produced nothing now says so** instead of leaving dead air.
- **Waiting behind a busy conversation is bounded and honest.** A message queued behind
  a running turn keeps saying it's queued, gives up cleanly after the time limit instead
  of piling up, and a message you abandon by closing the tab no longer runs for nobody.
- **Closing the laptop no longer breaks running tasks** — after a suspend, the cleanup
  pass waits one beat for live tasks to report in before declaring anything interrupted.
- **A colleague's run is labeled as the colleague** on the activity rail, never mistaken
  for the workspace's own conversation.
- **A workspace schedule now runs in the workspace's own conversation** — you watch it
  work in the thread like any other turn, instead of it running invisibly in the
  background.
- **A fired schedule no longer looks like you typing.** The prompt arrives as a quiet
  "Schedule · <name>" notice and Claude carries it out on the spot — a reminder is
  said to you right then, instead of Claude setting itself a timer or asking what you
  meant. Claude also no longer asks questions through a form that could never reach you.
- **Schedules on the Global menu now run.** A custom schedule created outside any
  workspace used to fail every time with "workspace not found"; it now runs as a
  regular Claude turn on your global conversation. Every scheduled run uses the same
  settings as the conversation it belongs to, waits its turn instead of writing over a
  running one, stops cleanly if it overruns, and several due schedules run at once.
- **A stuck Telegram (or other channel) message can no longer freeze everything else** —
  channel turns now end at the same time limit as typed ones.
- **The working rail shows the right chip again:** your own global turn reads as Claude,
  a Telegram turn keeps its chip, a voice turn opens the Voice chat, a spawned session
  shows its name (never a nameless "Working…").
- **"Hey Vynel" with the floating window turned off now answers out loud** instead of
  disappearing into the desktop app's main window. A spoken line from a schedule or
  another chat lands once, in the window you are talking to, and no longer vanishes or
  plays twice; on the browser side a turn that stays silent for five minutes says so
  once and still speaks its answer when it lands.
- **Saying "stop" while Vynel reads a long answer now stops it** — a one- or two-word
  interruption is no longer mistaken for an echo of its own speech. On a call, a reply
  that arrives while Vynel is saying it needs more time is spoken right after that
  line instead of being lost; a broken spoken turn shows its reason on the overlay.
- **A long delegated task could get a second writer.** After ten minutes the
  queue released a workspace's lock while the task was still writing, so the
  next task (or your own message) resumed the same session beside it. The lock
  now lives as long as the run.
- **A failed start could lose delegated reports for good.** The catch-up
  reports were marked "shown" before the assistant's turn actually began; a
  turn that died at startup lost them. They are marked only once the turn is
  under way.
- **A live call could stall for ten minutes on a card nobody could see.** The
  call leg fell back to Ask; it now runs the voice tier like every other voice
  leg.
- **The Global chat could show the spoken thread.** A voice turn announced as a
  global one, so a voice-first user could see their spoken conversation render
  as the global chat. Every live turn now carries its identity and readers
  match on it, never on an absence.
- **A retried report delivery landed the report twice.** A transient failure
  after the report row was written appended it again on retry; deliveries now
  carry a stable row id and re-use it.
- **Fleet dots painted "idle" before the status poll answered**, and a same-
  length reorder could hand one dot's position to its neighbour.
- **Voice speech during an overlay conversation was silently dropped** (a
  scheduled line, a typed Voice-chat reply); it now reaches the overlay, and
  the overlay skips only its own turn's copy.
- **A pending question could wedge the global thread forever**; interactive
  asks now expire, and a 60-second reaper clears the ones whose waiter died.

## [0.3.3] — 2026-08-19

### Added

- **Everything you customize now lives in your account, and it saves itself.**
  Persona and workspace icons, both colours, each workspace's menu layout,
  and where you dragged things in the left menu are stored in the database —
  open Vynel in another window or on the desktop app and it looks the same.
  Anything you had arranged before is carried over the first time. The
  Customize page lost its Save button: names save when you pause typing or
  leave the field, and every icon, colour and menu change saves the moment
  you make it (a quiet "Saved" note confirms). The Conversation icon has its
  own colour now, beside the workspace icon's — each with the palette and a
  custom swatch.
- **One Explorer-style file browser behind every folder or file pick.** Creating
  a workspace, adding a knowledge folder or file, and importing a memory file
  now open the same browser laid out like Windows Explorer: pinned places
  (Home, Desktop, Documents, Downloads, Pictures, Music, Videos) and "This
  PC" with every drive down the left; Back, Up and clickable address crumbs
  (**This PC › WORKSPACE (E:) › KLONE**) on top; large folder tiles in the pane;
  drive cards with a capacity bar and "51.2 GB free of 399 GB" under This
  PC. Click highlights, double-click opens. Drives read their real volume
  labels ("KAFI (D:)", "Local Disk (C:)") and free space. A **New folder**
  button on the browser's top bar makes a folder right where you are — the
  name box appears pre-filled, Enter creates it, and the new folder comes
  back already chosen. A folder that can't be opened (a locked system
  folder, a vanished USB stick) says why and steps you back instead of
  blanking the window. Windows' own system folders and files
  (`$Recycle.Bin`, `System Volume Information`, `AppData`, `pagefile.sys`,
  `desktop.ini`, …) stay hidden, the way Explorer's default view hides them.

### Changed

- **The left menu's workspace tree got a tidy-up.** Every workspace row now
  wears its own icon (the image you set in Customize, or its monogram over
  its colour) where a generic glyph used to sit, and its state moved to the
  right where the eye expects it — a bolder spinner while it works, a ringed
  status dot when it needs you / hit a problem / finished, the play mark
  when parked. Groups are compact, titled in bold with a hairline under, and
  wear a stack glyph instead of a folder, with their members set a step
  in so an ungrouped workspace below reads as its own. Creating lives in a
  strip **above** the Global row — **+** for a new workspace and a
  stack-plus for a new group (which opens straight into its rename box) —
  and each group has its own **+** that opens New workspace already filed
  into that group; the New workspace dialog gained a **Group** pick with an
  inline **New group…**. Clicking a workspace row always opens that
  workspace's chat.
- **The left menu keeps your order — and you set it by dragging.** The
  NOT RUNNING group is gone: a quiet workspace dims where it sits instead of
  jumping to the bottom. Drag a workspace above or below another to reorder
  it, onto a group's title to move it into that group (last), or onto the
  empty root area to take it out; drag a group's title above or below
  another group to reorder groups. Where you put things stays put.
- **Drag and drop now works in the desktop app.** The desktop shell's own
  drag-drop hook was swallowing every drag on Windows; it's off, so the
  sidebar's reorder and regroup drags behave like they do in the browser.
  (Needs a desktop rebuild to take effect.)
- **Pick any accent colour.** Customize → Accent color has a custom swatch
  beside the palette: choose any colour and the workspace's icon in the
  left menu, its chips in chat, and its rail mark all take it.
- **New workspace picks its own name.** Choose the folder first; the name
  fills in from it (edit it if you like) and **Continue** creates the room.
  A whole drive or your home folder can't be a workspace — the dialog says
  so and waits for a folder inside.
- **A workspace's manager is named after the workspace by default.** A new
  room's persona used to get a random first name ("Sarah is handling
  Bookkeeping"); it's now the room's own name ("Bookkeeping is handling it")
  until you rename the persona in Customize. Labels that read "persona ·
  workspace" collapse to the workspace alone when the two match, and the
  @-mention roster only offers a persona whose name can be typed as one
  token — a multi-word workspace name is left out until its persona is
  renamed.
- **The default chat model advanced to Claude Opus 5.** A fresh install (or a
  cleared composer preference) used to start on Opus 4.8; it now starts on
  `claude-opus-5`. Sessions where a model was already chosen are untouched, and
  turns that omit a model still fall to the engine default.

### Fixed

- **A request body that isn't valid JSON now gets a 400, not a 500.** Both
  the engine and the hub answered malformed JSON (a Windows path pasted with
  raw backslashes, a truncated body) with "Internal server error"; they now
  say `validation_failed · Malformed JSON in request body` on the usual
  error shape. Every framework-level HTTP failure (payload too large, …) is
  mapped the same way instead of falling into the 500 bucket.
- **Child sessions now honor the mode of the turn that tasked them.** The
  delegating turn's permission mode (Ask / Auto / Bypass) travels to the
  enqueued task through an internal header, but only the global chat's turn
  runner was stamping it — a workspace chat or a session DM on **Auto**
  enqueued modeless tasks, so children fell back to the conservative
  background default and asked approval for Write/Bash despite the parent's
  Auto. All three interactive turn runners now stamp the resolved mode, and
  a delegated turn re-stamps its job's mode on its own sends, so the whole
  chain (auto root → child → grandchild) inherits end-to-end. A session
  whose mode was never set still keeps the conservative default for its
  delegations.
- **A failed turn can no longer corrupt a session's context meter.** The
  engine reports errors like "Prompt is too long" as a synthetic message
  carrying a fake `<synthetic>` model and zeroed usage; persisting that
  overwrote the session's real occupancy with 0 and its model with
  `<synthetic>`, so the meter's denominator fell to the 200k floor (while a
  1M model was selected) and the automatic context swap went blind. The
  translator now drops the fabricated usage — the error text still shows,
  and the session keeps its real numbers. Existing poisoned rows in the dev
  DB were healed in place.
- **Voice turns no longer die on a large global conversation.** Voice pins a
  fast small-window model; once the global brain had grown past that window
  (legitimate under its 1M-window models), every voice turn hard-failed with
  "Prompt is too long" — hands-free, with nobody watching the error. A
  pre-turn fit check now sets the pin aside for that turn and runs on the
  session's own model instead (or the engine default), without persisting
  anything over the user's chosen settings.

## [0.3.2] — 2026-08-19

### Changed

- **All live updates now ride ONE connection per window.** The activity feed
  and every open thread's live watch used to hold their own HTTP stream —
  and browsers (Tauri's WebView2 included) allow only six HTTP connections
  per host across all windows, so a few running threads froze polls and even
  sends with no error. They now share a single WebSocket per window
  (`/api/live`), which sits outside that limit; ten workspaces with their
  child sessions all live at once cost nothing extra. Opening a workspace
  whose turn is already running shows the turn immediately, seeded from
  what has already been persisted, and a fresh workspace's very first turn
  is now visible from every window while it runs, not only the one that
  sent it. A dropped socket reconnects with backoff and re-subscribes on its
  own.
- **Sending a message no longer holds a connection for the whole reply.** The
  send hands the turn to the same live view as soon as the engine has taken
  it; the reply streams over the shared socket. Stop, queued messages and
  failure notes work exactly as before.
- **Voice rides the same socket.** The engine keeps one link per surface to
  the voice daemon and relays wake, speaking state and delegated speech to
  the windows; speak stays instant, and Jarvis + the main window no longer
  spend connections on it. `VYNEL_MAX_CONCURRENT_DELEGATIONS` (default 3)
  can raise the delegated-run pool until the user-facing setting lands.

### Fixed

- **A reply the engine produced without streaming it no longer vanishes.**
  When the Claude engine's stream fails mid-request it retries the request
  in non-streaming mode and hands back the finished answer in one piece.
  Vynel used to discard that piece as "already streamed" — the turn ended
  clean, the thread showed nothing, and the answer existed only in the
  engine's own transcript (the 2026-08-18 "idle workspace": a 100-second turn
  with no reply). The finished text and thinking now land in the transcript
  as one final chunk when nothing streamed before them; a reply that did
  stream is never doubled.
- **Voice no longer listens on Vynel's own virtual call microphone.** Windows
  makes a freshly installed capture endpoint the default recording device —
  including the call driver's own "Vynel Call 1 Microphone", which hears
  nothing from the room (the "wake doesn't work" report). When no input
  device is configured and the default is one of the driver's endpoints,
  voice now takes the first real microphone that can record and says so; an
  explicitly configured device is honored as before.

## [0.3.1] — 2026-08-18

### Added

- **Agent spawns now show as pointers, like delegated tasks.** When Claude
  spawns a subagent (research, review, exploration), the thread shows the same
  compact pointer card a delegated task gets: what the agent is doing, its
  name, and — on the same line — its latest tool call or message, live while
  it runs. Clicking opens the sidebar with the agent's full nested activity;
  a failed run wears the error treatment whole, and a run paused on an
  approval reads "Needs input".
- **A Claude account popup on the title bar.** The coral Claude mark (after
  the Tabs|Menu toggle) opens one dialog with two tabs: Account — who this
  computer builds as (email, organization, plan from the CLI's own report),
  the last week's token usage per model, and a real sign-in flow (link out,
  pasted code back — the CLI writes its own credential, Vynel never touches
  it) with a switch-account door for expired auth or a second subscription;
  Limits — the `/usage`-style windows (current session, weekly, per-model)
  as bars with reset times, captured from the engine's own reports as turns
  run.

- **Tasks are now the workspace's work queue — file a task and Claude picks it
  up.** A task you add to the panel nudges the workspace's assistant: it takes
  tasks one at a time in order, asks you first when something is genuinely
  ambiguous (a short form attached to the task, with concrete options), sizes
  the work (small work goes straight to a checklist; bigger work gets a plan
  first), and works through visible steps.
- **Every task shows its steps on the task panel.** Rows carry an n/m progress
  count and unfold into the task's checklist; you can tick or reopen steps
  yourself. The task view also links the plan behind the task and the session
  working it.
- **The task panel opens by default** and starts with a workspace activity
  header: how many tasks are done of the total, and how many sessions are
  working — expandable into the list of working sessions for that workspace.

### Changed

- **The Claude auth status now reads the CLI's own JSON report** (email,
  organization, subscription) instead of hand-parsing the credentials file —
  the account label was silently dead in production before this.
- **Plans can now belong to a task.** A medium/large task gets an execution
  plan linked to it (goal, parts, approach, risks), and its steps derive from
  that plan; day-wise plans are unchanged.
- **The task-planner notebook was rewritten** around the new flow — pickup,
  clearance, sizing, execution — so the assistant works panel tasks and chat
  requests through one identical, visible discipline.

## [0.3.0] — 2026-08-18

The first release cut from the rebuilt trunk (`main`); earlier 0.2.x installers were cut from the
design branch. Everything below is what the trunk gained since the 2026-07-04 keystone.

### Added

- **A context hand-off that could not land now says so.** Alongside the
  existing "hand-off started" and "hand-off landed" signals, Vynel records a
  "hand-off aborted" signal (with why — no usable summary, or a failure) so
  anything watching a conversation can tell an aborted hand-off from one still
  running instead of waiting forever.

### Fixed

- **The global assistant can now read its own earlier context after a
  hand-off.** When a long conversation continues on a fresh context, the
  hand-off tells the assistant which earlier segment to read for more — but
  the read tools walled off the global assistant's own thread from *everyone*,
  including the global assistant, so that pointer was a dead end for exactly
  the conversation the whole continuity work started from. The wall is now
  identity-aware: the global assistant reads its own segments (search and
  read-by-id); no workspace, spawned session, agent or outside client can
  read them — same as before.

- **A second browser tab no longer "freezes" the app while a conversation
  works.** Every open thread used to hold a live-watch connection to its
  session at all times, on top of the app's activity feed, the voice link and
  a running turn's own stream — and browsers allow only six connections per
  origin, shared across tabs. With two tabs open during a long turn (longer
  still since a conversation now patches context and continues on the same
  stream), every other request queued behind them: blank panes, spinners,
  "the engine looks stuck", until something ended. A thread now opens its
  watch only while the activity feed says a turn is running on that session
  and this view would actually show it (a thread rendering its own turn
  holds no second connection), and lets it go when the turn ends. Nothing is
  missed — the persisted rows seed a late attach, as they always did.
- **The "patching context" and "continuing" clocks now count their own
  phase.** The chip read "patching context · 7m 39s" after a seven-minute
  turn — the elapsed was the whole turn's. It now counts from when patching
  (or the continuation) began; a finished turn reads its whole duration again.
- **A session thread says "Needs input" while it waits on you.** When a
  spawned session's turn parks on an `ask_user` form or an approval, its
  thread now shows the same "Needs input" state the workspace thread does,
  instead of a bare "continuing"/"working" pill — the corner toast is no
  longer the only sign.

### Added

- **A long task no longer stops at the context limit — the assistant checkpoints
  and continues by itself.** While a conversation is working (a long agentic
  turn), Vynel now tells the model, beside a tool result, when it has crossed
  the hand-off point — how much room is left in tokens, not just a percentage
  — and asks it to finish the slice it is on, name the single next step with a
  new `checkpoint` tool, and end the turn with a one-line note to you
  ("I'll continue after patching context"). The usual hand-off then runs
  (visibly: "patching context"), and Vynel starts the next turn itself on the
  fresh context — no message from you needed — with a short "Continuing after
  patching context — next: …" row in the thread and the pill reading
  "continuing". Works the same for the global assistant, project chats,
  spawned sessions and agent colleagues; a delegated background task
  continues as a follow-up job on the same task. Only a checkpointed turn
  continues automatically (an idle conversation or a finished task never
  restarts on its own), a runaway is capped at three continuations in a row,
  and the hand-off itself now names the checkpoint's next step so nothing is
  lost even if the continuation cannot run.

- **You can see a conversation continue onto a fresh context.** When a long
  conversation is handed off to a fresh context, the chat now says so for
  those seconds — a "patching context" chip where "done" would sit, the
  thread's pill reads "Patching context", and a message sent in the middle of
  it says "Patching context — your message continues right after" instead of
  the generic "working on a task". Other surfaces (the activity feed, a
  watched session) narrate it too. Nothing about the hand-off itself changed
  — it is simply no longer invisible.

- **Every conversation can ask who it is.** A new read-only `whoami` tool
  rides every kind of session — the global assistant, a project's main
  conversation, spawned sessions, agent colleagues, scheduled runs — and
  answers from Vynel's own records: which conversation it is, which segment
  it continues from, how full its context is against the point where it will
  continue on a fresh one, which *duty book* teaches its role (and whether that
  book is published yet), and the memory tags to stamp on anything it saves so
  what it learned stays findable as its own. Duty books are wired now and
  filled in later: the moment a book for a kind lands on the notebook shelf,
  every session of that kind starts reading it — no release needed.

- **A richer hand-off when a conversation continues on a fresh context.** The
  fresh session now starts knowing *who it is* (the global assistant, a
  project's main conversation, a named spawned session or agent colleague),
  the distilled summary of where things stand, the last few messages exactly
  as they were said, which earlier segment it continues from, and how to look
  up more when it needs it (its own recorded history, memory, knowledge, the
  journal, and a new notebook book, *Continuing after a context swap*). It is
  composed only from that conversation's own history — never another
  session's. Also fixed: a spawned session's name no longer flips to "Session"
  in task labels after its context continues on a fresh segment.

- **Every conversation now keeps its context across the limit — the global
  assistant included.** Vynel already knew how to hand a long conversation off
  to a fresh one before it hit the model's ceiling (a distilled hand-off, then
  a fresh session seeded with it — the "Continued conversation" segments), but
  only your project chats ever ran that step. The global assistant, delegated
  project tasks, spawned sessions and agent colleagues only ever *recorded*
  which session they were on — none of them measured how full it was — so the
  global assistant rode straight into the limit and woke up on a blank session
  with the whole conversation gone. Now one shared step runs at the end of
  every turn, for every kind of conversation: read how full the session is,
  and at 85% hand off — before the next turn, invisibly. Each conversation
  keeps *its own* thread of context (a spawned session working on one feature
  carries that feature, never another session's), the fresh segment lists
  where its owner lives (the global thread stays workspace-less; a colleague's
  stays under its project) and inherits the thread's mode and model, and the
  full chat still shows across every segment.

- **One status rule everywhere.** A project, a conversation and the row in the
  sidebar now mean exactly the same thing by the same colour: *needs you* is a
  question waiting, an approval waiting, or Claude saying so itself — and
  *problem* is the engine unreachable, a turn that finished failed, or a limit
  error. The node screen used to run its own reading over the task queue, where
  "NEEDS YOU" was the leftover branch — so projects that had merely chatted in
  the last hour wore amber with nothing pending, on the one screen named for
  showing you what needs you. It also had no red at all, so a project whose
  last turn failed was red in the sidebar and grey there. The Grid tab said
  only "Working now" or "Nothing running", and the top bar counted a failed
  project under "paused"; both now name every state.

- **The Sessions library scrolls.** Past 50 conversations it showed the newest
  50 and said nothing about the rest — older ones were unreachable. It now
  loads more as you reach the bottom, and the menu's `Sessions` count is a real
  total instead of stopping at 50 too.

- **The menu's `Rules` count stopped reading your rule files.** Counting them
  opened every file and parsed it just to produce a number, on a path the menu
  refreshes constantly. It counts the files now.

- **Fixed: a conversation waiting on your answer looked like it was still
  working.** When Claude puts a question form in front of you, the turn pauses
  until you answer — but the conversation kept showing the "working" light, so
  nothing told you it was your move. Worse, in a project chat the question was
  filed without recording which conversation it came from at all. Both are
  fixed: a conversation waiting on a form now shows the same "needs you" light
  as one waiting on an approval, on its Sessions row, its dot on the node
  screen, and the Assistant row in the shell.

- **Fixed: a project never lit up when its own background session needed your
  approval.** When Claude handed work to a session it spawned inside a
  project, any approval that session raised was filed as belonging to nobody —
  so the project sat looking idle while its child waited, and the approval
  showed up under Global instead, for work that wasn't global. Approvals now
  carry both the project and the conversation they came from, so the room
  lights up and you can tell which conversation is asking. The same fix stops
  a spawned session quietly leaving its project's Sessions list after a long
  conversation.

- **Fixed: Opus appeared as "Default (recommended)" under "More models", and
  picking it failed the turn.** The engine names its models with aliases and
  reports the 1M-context Opus as `claude-opus-5[1m]`. Three things went wrong
  with that: the generic "default" pointer won the naming race, so Opus wore
  that label instead of its own; the bracketed suffix made the version
  unreadable, so the newest Opus sorted behind "More models" while older
  families sat up front; and the same suffix failed an id check, so choosing
  Opus was rejected before the request ever reached the engine. The picker now
  reads **Fable · Opus (1M context) · Sonnet · Haiku**, and every one of them
  runs.

- **The model list is now asked for, not stumbled upon.** Which models the
  picker offers is account-specific — and Vynel only ever learned the list as
  a side-effect of you sending a message, so a freshly opened app showed the
  built-in list and a list that changed (a different login, an entitlement
  change) only caught up on your next chat. Vynel now asks the engine directly
  at startup, and can be asked again at any time; it costs nothing (no message
  is sent) and a failed ask never wipes the list it already had. The effort
  picker also stops offering levels the chosen model can't run — it used to
  show all five and let the engine quietly downgrade your pick.

- **Conversations now carry a status light — including "stuck on an error".**
  When a turn dies (the account's session limit, a failed run), the error used
  to live only as red text inside the transcript: nothing in the Sessions list
  or on the node screen could tell you a conversation was stuck. Each
  conversation now shows its own state — working, waiting on you, hit a
  problem, completed — with the one-line reason beside it (the limit message
  itself, or the assistant's own note). Claude can set it deliberately too
  (`set_session_status`, the per-conversation twin of the workspace one), and
  it clears itself when you send the next message. The Global row can finally
  show a problem, and conversation dots on the node screen show the real state
  instead of guessing "waiting on you" from the clock.

- **Each conversation now remembers its own mode, model, effort, and Auto
  buildout.** The composer chips used to be one global setting — changing the
  model in one chat silently retargeted every other conversation's next turn.
  They now live on the session itself: a chip change persists to that session
  immediately (no send needed), a turn sent without explicit settings runs on
  what the session has stored, and a conversation that continues onto a fresh
  segment keeps its settings. The chips only act as defaults for brand-new
  chats; the first turn stamps them onto the new session. Voice keeps its own
  fast spoken-turn tier and never touches your chips; Telegram and other
  channels still run on the assistant's standing defaults for now.

- **Claude can run commands in the background and get woken when they finish.**
  `run_background_process` starts a shell command — a test suite, a build — that
  keeps running after the conversation moves on, even across its pauses; when it
  exits, the session that started it is woken with the exit code and the output
  tail (a completion watch is armed automatically). Companion tools list, fetch,
  and kill them; every process has a hard runtime ceiling, a restart settles
  interrupted ones honestly, and in ask mode starting
  one shows an approval card first.

- **Sessions can now talk to each other without handing out work.** `send_message`
  gained `kind: "note"` — plain coordination between any two of your conversations
  ("when you finish, tell the planner session"; "I'm editing that file, leave it
  alone"). A note reaches ANY workspace or session — including ones the sender
  doesn't parent — precisely because it can't create work: no task, no report
  expected, nothing tracked anywhere. The receiver reads it in its own
  conversation under a "Note" badge, signed with who sent it and how to answer.

- **A call can be told which app to listen to, by name.** `start_call` now
  takes the hosting app's name ('chrome' for a Meet tab, 'Zoom') and Vynel
  scopes its hearing to that app and its children — your music and
  notification sounds no longer leak into what the call hears.

### Changed

- **Tasks only travel to your own sessions.** A workspace can no longer hand a
  task to another workspace's session (or to the global assistant's own
  sessions), and the global assistant routes work through the owning workspace
  instead of reaching past it — the refusal names the workspace to send to
  instead. Work now always flows Global → Workspace → Session; cross-parent
  *communication* is what notes are for. This also closes the recorded bug where
  a root-assigned task's report could land in a workspace chat that never asked.
- **`model`/`thinkingEffort` on a non-task message are now rejected** instead of
  being silently ignored on reports and updates.
- **"Background runs" are now called what they are: delegated tasks.** The
  read-back tools renamed to `list_delegated_tasks` / `get_delegated_task`
  (routes `/routing/delegated-tasks[/:jobId]`) — the old name read like an
  OS shell process running in the background, when what it lists is the tasks
  you handed to other sessions.

### Fixed

- **Vynel no longer talks over itself or gets cut off by noise on calls.**
  Three live-Meet findings fixed: the keep-warm silence trickle could land
  inside a sentence and split words mid-speech; any sound on the machine —
  including Vynel's own voice echoed back off the far end's speakers — would
  cut Vynel off mid-line (interruption now happens only on a real transcribed
  utterance); and those echoed lines were being answered as if a participant
  had said them (they're now recognized and dropped).

- **A Windows call just hears itself — no cable, no setup.** When Vynel's own
  audio device is installed, a call hears the meeting by capturing everything
  playing on the machine *except Vynel's own voice* (so no echo) — no capture
  cable, no picking which app, nothing to configure. Point it at one specific
  app instead by passing its process, if you'd rather not capture other audio.
  The existing device-cable setup (VB-Cable, Linux null-sinks) is unchanged.

- **Vynel's own Windows call cable is real, and it carries a call.** The
  virtual-audio driver is a working one-way cable, proven on real hardware:
  audio played into **Vynel Call 1 Voice (Vynel Audio)** comes back out
  **Vynel Call 1 Microphone (Vynel Audio)**, which a call app selects as its
  microphone — so Vynel speaks into a meeting through a device it ships
  itself, with no third-party cable to install. Paired with the per-app
  capture above, a Windows call needs this one cable and nothing else. It
  runs at 48 kHz and folds whatever channel layout an app asks for down and
  back, so an app's format choice can't garble the audio, and it registers as
  a line connector rather than a speaker, so Windows never quietly makes it
  your default output. For now it carries Vynel's own test signature, which
  covers our testing — putting it on other people's machines needs Microsoft
  attestation signing, a separate step.

- **On Windows, Vynel can hear a call with no cable to install.** A new native
  module captures a single app's audio directly (Zoom, Teams, a Meet tab) —
  the "ears" half of a meeting — so a Windows call needs only one virtual
  cable for Vynel's voice, not two. Off-Windows or until the module is built,
  Vynel falls back to a cable feed exactly as before.

- **Vynel finds its own call cables.** Virtual audio devices named
  `Vynel Call <n> Ears/Voice` are now claimed as call cable pairs
  automatically, checked fresh at every call start — install a device and
  the next call just uses it, no settings, no restart. The env-var cable
  setup keeps working as the fallback, and two calls can never grab the
  same cable end.

- **On Linux, calls need zero audio setup.** The voice daemon now creates
  its own virtual cable pairs when it starts (plain PipeWire/PulseAudio
  null sinks — no driver, nothing installed) and removes them when it
  exits; leftovers from a crash are cleaned up at the next start. Pick the
  pair count with `VYNEL_CALL_LINUX_PAIRS` (default 2, `0` turns it off).
  Real-Linux-box verification is still pending — recorded in the module
  note.

- **See everything Vynel is working on, at once.** A new **Nodes** word in the
  top bar opens a live picture of your whole fleet: every project is a dot
  orbiting the centre, and its colour says what is happening — purple while it
  is working, orange when it is waiting on you, green when it has finished and
  nothing is left in the queue, grey once it has been quiet for an hour. Busy
  projects stream light along their strand; quiet ones barely flicker. Click a
  project and you step inside it — the same picture, except the dots are now its
  conversations, each lighting up and streaming while it is actually running,
  and clicking one opens the chat. The same fleet reads three
  ways: **Nodes** (the constellation, arranged as Constellation, Orbit or Rise),
  **Grid** (the same projects as plain cards) and **Race** (everything on one
  track toward done). With nothing set up yet the stars still turn and the
  centre stays lit, with an invitation to add your first workspace.

- **You can watch them talk to each other.** When one of Vynel's conversations
  sends something to another, a light travels the curve between their two dots
  and the line stays for about a minute afterwards — so you can look away and
  still see what just happened. Going out is one colour, coming back is
  another, so an exchange reads as question and answer at a glance. It works
  both on the whole-fleet picture and inside a single project, and a message
  to or from Vynel's own top-level brain simply runs to the centre, because
  that is what the centre is.

- **Tool access is now set from mission control.** The cloud admin portal
  grew a Tool policy page: every tool Claude ships with, editable in one
  matrix — on/off, where it's available, when it needs approval, which plan
  tier or capability it rides. Each desktop release bakes the current map
  in at build time, so a policy change rolls out with the next version —
  predictable, versioned, and visible (the page shows the exact map hash a
  build would ship). Your own Tool access panel in the app still works on
  top of the shipped defaults; anything you customize stays yours.

- **Every project wears one status light.** A workspace is now always in one
  of five states — running, waiting on you, hit a problem, completed, or not
  running — and the same colour tells the story on every surface: the
  workspace tree's mark dots and `done/total` task counts, the tab strip's
  chips and pulsing dots, the work rail's headline card, and the chat
  header's badge. Claude sets the state itself (a new `set_workspace_status`
  tool: "completed" once everything on the list is done, "problem" when it's
  stuck, "needs input" when a conclusion needs your call — with a one-line
  why that shows on the rail), and Vynel detects the rest: a crashed or
  errored session turns the light red, a pending approval or question turns
  it blue, and your next message clears a stale state automatically.

- **The chat reads as one card per exchange.** Your ask and Claude's whole
  reply now live in a single card — the newest exchange sits open on the
  surface, older ones fold to a quiet one-line strip with "read more" and
  wake on hover, and the live exchange keeps its glowing spine and working
  timer. When a workspace is waiting on you, stuck, or done, the latest card
  carries the verdict pill in that state's colour.

- **Navigation looks the way the design says.** Tabs mode grew real
  browser-style tabs that sit on the canvas edge (state chip + name + status
  dot, parked rooms dimmed); menu mode's workspace tree shows each room's
  state chip, task progress, and status mark, with quiet finished rooms
  tucked under a collapsible NOT RUNNING group; the drilled sidebar leads
  with the workspace's identity card and its live status line. The title bar
  wears the accent Vynel mark on the chrome ground, and the composer's send
  button matches the design's accent chip.

- **You decide what Claude can touch.** A new "Tool access" panel in the
  workspace toolkit lists every tool Claude has — grouped by feature — and
  makes all of it editable: turn a tool off entirely, choose where it's
  available (chat, background jobs, channels, agents…), set when it needs
  your approval (never / when asking / always), and bind it to a plan tier
  or capability toggle. The workspace capability switches (memory,
  knowledge, notebook) get their first real UI in the same place. Tools
  your plan doesn't include simply don't exist for Claude anymore, instead
  of failing when it tries them.

- **Claude can ask you a question mid-job.** Work running in the background
  (a Telegram message you sent it, for example) can now pause on a short
  form when Claude genuinely needs your call — you get a nudge on your
  connected channel, and the answer flows straight back into the running
  job. If you don't answer within 10 minutes it continues with its best
  judgment and tells you what it assumed. Questions asked in the app still
  wait for you as long as it takes.

- **Tasks open into a full view with their real steps.** Click any task in
  the work rail to see everything about it — status, who added it, its
  write-up, and (for tasks the assistant has actually worked) the genuine
  step list from that session with a progress bar. A little + on the rail
  quick-adds a task to whichever room you're in.

- **The tasks dock grew into a work rail.** Toggle it from the title bar as
  before — it now leads with a live card that mirrors the room's presence
  (glowing while the assistant works, blue when something waits on you, quiet
  otherwise) with real step progress from the running session, splits tasks
  into "In the queue" and "Completed" pill tabs, and — in a workspace — ends
  with an OPEN IT block: one-click links to the apps actually running on
  their ports, and a stop button (with a confirm) that interrupts the current
  work without touching anything already finished.

- **The conversation reads like a task list now.** Every chat surface groups
  each exchange into its own card: past turns quiet down to dimmed one-line
  strips that wake when you hover (click to reopen them), the latest turn
  sits in a clean card, and while the assistant works its card glows with a
  sweeping light along the edge and a live "working · 1m 32s" pill ticking in
  the corner — you can tell at a glance what's history, what's current, and
  what's in motion.

- **Folders for your projects.** In Menu navigation the workspace tree now
  has real folders: make one with the new-folder button, drag projects in and
  out (or back to the top level), right-click to rename or delete. Deleting a
  folder never touches the projects inside — they just move back to the top.
  Folders live in Vynel's database, so they follow you across restarts.

- **Two ways to move between your projects: Tabs or Menu.** A new switch in
  the title bar picks how workspaces are navigated. Tabs keeps the familiar
  browser-style strip. Menu tucks the strip away and roots the sidebar at a
  workspace tree — every project in one list with a pinned Global entry;
  click a row to switch rooms while you watch the canvas, or drill in to open
  that room's menu (and step back out with one click). Both views share the
  same open tabs underneath, so flipping modes never loses your place. Either
  way, the navigation now shows live presence: a room's chip spins while the
  assistant works there, and a soft blue dot pulses when it's waiting on you.

- **Design changes are now traceable.** Vynel's UI designs from claude.ai/design
  live in the repo as a git-tracked mirror (`.claude-design/`), refreshed
  wholesale from each export zip by the new `/sync-design` command — so every
  design iteration is one commit and `git diff .claude-design/` shows exactly
  what changed upstream. Seeded with the first design pack: the "New app"
  onboarding wizard modal flow plus six Vynel Workspace screen states, built on
  the Nocturne design system.

- **Pick what you run: `pnpm dev` now takes app names and a port band.**
  `pnpm dev api web` starts just the engine and the UI; `pnpm dev cloud admin
  api web voice` is the full stack; `--base 28890` (or `--port 28892`, named
  by the engine port) shifts the whole instance to another port band in one
  flag — perfect for running a second copy beside the first. Bare `pnpm dev`,
  `dev:local`, and `dev:full` behave exactly as before.

- **Vynel never fights over a port again.** The installed desktop app now
  *allocates* its local port each time it starts instead of assuming the
  default is free — if Docker, WSL, or any other app holds it, Vynel quietly
  picks the next free one and every window and companion tool (CLI, voice,
  Claude integrations) finds the engine wherever it actually landed. The
  same rework gives developers one-variable side-by-side checkouts: every
  port derives from a single `VYNEL_PORT_BASE`, and `pnpm worktree:env`
  claims a free band for a fresh worktree automatically. Release builds also
  stopped failing when Docker reserved the build's fixed test port — the
  proof-of-life boot now borrows a free port from the OS.

- **Vynel can sit in your meetings.** Ask it to join a call (Zoom, Meet,
  Teams, Discord — anything whose audio you point at the virtual cable) and
  it opens a dedicated call session you can watch live in Sessions. In a
  group call it takes notes and only speaks when addressed by name or when
  something truly needs saying; in a one-to-one it converses naturally, and
  you can talk over it — it stops mid-sentence. It announces itself out loud
  when it joins, joining always asks your approval first, and when the call
  ends the whole conversation stays searchable with a summary on request.

- **Choose which microphone and speaker Vynel's voice uses.** Until now the
  voice assistant always used your system-default devices. You can now point
  it at a specific microphone or speaker by name — the first building block
  for letting Vynel join meetings through a virtual audio cable. If a named
  device isn't there (say the cable isn't installed yet), Vynel says so
  plainly and falls back to the default instead of failing to start.

- **Claude keeps an engineering build plan for your project.** Two new
  workspace lists the assistant maintains through its own tools: **Phases** —
  how the app gets built, stage by stage, each phase a full write-up (scope,
  decisions, what "done" means) with its place in the build order — and
  **Features** — what the app should have, each a full write-up of what it
  does, linked to the phase that delivers it. Lists show short previews; the
  full text is read per item, so plans can be as detailed as they need to be.
  Both ride their own capability toggles, and deleting a phase or feature
  asks for your approval in ask mode.

- **Edit an app's env from the Apps menu.** Every app row now has an Env
  button that opens the settings file the app actually reads (its `.env` —
  Claude points at the right file when it registers the app). See every
  variable with values hidden until you reveal them, add, change, or remove
  entries, and save — comments and formatting in the file survive the
  rewrite. Editing stays yours alone: the env values are never exposed as
  assistant tools, and files using multi-line values are left for your code
  editor rather than risk mangling them.

- **Claude waits for things properly.** When something takes a moment — a page
  loading, a dialog opening, a file saving — Claude can now wait for it instead
  of taking screenshot after screenshot to check. It carries on the instant the
  thing it's waiting for happens, and if it never does, it says so and looks at
  the screen rather than waiting again blindly. It's also been told more firmly
  that a tool reporting success only means the action was *sent* — it has to
  see the result before telling you something is done.

- **A long run of desktop steps can't hog your computer.** While Claude is
  part-way through a group of actions it can't be interrupted, so that group is
  now time-limited: it stops itself, tells Claude exactly how far it got, and
  hands control back. Stopping still isn't instant, but it can no longer be
  ignored for minutes at a time.

- **Claude can work on your computer in the background.** Hand Claude a desktop
  task and it can now run in a session of its own while you carry on talking —
  before, a desktop task tied up the whole assistant until it finished, so a
  message from your phone just queued behind it. The overlay still shows every
  step as it happens, and Stop now reaches the session actually doing the work
  rather than the conversation you're in. Background work stays on apps you've
  already allowed: if it needs a new one, it asks and waits.

- **Copy and paste between apps.** Claude can read what you've copied and put
  text on your clipboard, which is far more reliable than retyping — it keeps
  formatting and can't accidentally hit Enter halfway through. Because the
  clipboard belongs to your whole computer and might hold a password you copied
  a moment ago, it's only available while you're there to see it, it's named
  plainly on the overlay when it happens, and its contents are deliberately
  never saved into your chat history.

- **Claude knows about your other screens.** It can now see how many displays
  you have, where they sit and how they're scaled, instead of assuming a single
  screen — so asking about "my other monitor" works, and clicks land correctly
  on a display that isn't your main one.

- **Dragging things actually works.** Drag-and-drop used to jump straight from
  one point to the other, which moves a slider but is invisible to anything
  waiting to receive a drop. Claude now drags the way a hand does, so dropping a
  file onto a window lands. Claude can also hover, to open menus that only
  appear when you point at them.

- **Claude can open an app that isn't running.** Ask for something in an app
  you don't have open and Claude can now find it among your installed
  programs, start it, and wait for its window before carrying on — so "open
  Chrome and search YouTube" works from a cold start. Starting a program
  counts as an action: it only happens for an app named in a plan you
  approved, it never guesses between similarly named programs, and permission
  to *look* at an app is never permission to launch it.

- **The desktop overlay says whether Claude is looking or driving.** While
  Claude touches your computer, the overlay now names which of the two is
  happening and — once you've approved a plan — shows that plan next to the
  live steps, so you can follow along against what you agreed to. It appears
  whenever Claude reaches for your desktop in every mode; approval mode just
  adds the card. Two gaps closed: work Claude handed to a helper used to run
  behind a dark overlay, and desktop approvals no longer appear twice.

- **Desktop steps run in one go.** Claude can now group actions it already
  knows — click the search box, type the query, press enter — into a single
  step instead of one slow round-trip each, so watching it work feels closer
  to watching a person. The group stops the moment something doesn't go as
  expected and tells you exactly what did and didn't happen, and the overlay
  names both the first action and the last one, so a step like "send" is
  never hidden behind a count.

- **Auto mode now truly never asks.** Picking Auto means you're not
  interrupted — but a safety escalation could still raise an approval you
  weren't expecting, and if nothing rendered it, the task simply stopped and
  waited forever. Auto now runs without approvals of any kind, exactly like the
  label promises. Ask mode is unchanged and still asks.

- **Approvals can no longer hide behind the desktop overlay.** The overlay sits
  in the screen's bottom-right corner, on top of everything — the same spot
  approval notifications used, so one could be completely covered and
  unclickable while the task waited on it. Notifications now dock to the other
  side whenever the overlay can appear.

- **Minimized apps no longer stop the assistant.** Ask it to look at something
  you've tucked away and it opens the window and looks — no more "please restore
  it first", which was useless when you're away from the machine. It can
  also arrange windows on purpose now: maximize an app it just opened so the app
  is actually usable, or minimize one to clear it away. Windows it opens are left
  open, so you can see what happened when you come back.

- **A playbook for driving your desktop.** The assistant's notebook gained a
  book on working your computer well: reach for a keyboard shortcut before
  hunting for a button, press the real control rather than a pixel, batch the
  steps that belong together, and check the screen afterward instead of
  assuming. It also knows what Windows simply won't allow — administrator
  windows, security prompts — so it tells you plainly and hands those back to
  you instead of silently failing.

- **Desktop control asks once — for the whole plan.** Before touching your
  computer, Claude now proposes its full plan: the goal in your words, the
  steps it will take, and every app it needs. In ask mode you approve that
  one card — goal, numbered steps, apps in plain tier words ("look, click +
  type"), with the "AI can make mistakes" note at the bottom — and the steps
  then run without per-click interruptions. The approval covers only that
  task: nothing is silently remembered, and background/remote turns still
  can't grant themselves anything new. Deny the plan and nothing moves.

- **Any session can now read any conversation.** Every tier — workspace
  chats, spawned sessions, agent colleagues, and the global assistant —
  carries one search tool over all your conversations (optionally narrowed
  to a workspace) and one read tool that opens any conversation in full,
  so a session grabs context from another the moment it needs it. The one
  exception is deliberate: the assistant's own global thread stays private
  and never surfaces through either tool.

- **Plugins can now install into just one workspace.** Every plugin — the
  hub's and your added marketplaces' alike — appears on workspace shelves
  too: Get there installs it for that workspace only, keeping its skills and
  commands out of every other session's context (installing from the global
  Marketplace still makes it available everywhere). Each shelf shows its own
  install state, and chat sessions still can't install plugins for you —
  the click in the Marketplace panel is the consent that plugins run code.

- **The admin portal reviews whole marketplaces.** A new "Import from
  marketplace" page inspects any GitHub-hosted Claude plugin marketplace at
  a pinned commit, lists its plugins with checkboxes, and publishes exactly
  the approved ones into the official catalog as community items — available
  to everyone, never badged official. Re-running is safe: already-published
  plugins simply skip.

- **Add whole marketplaces, not just items.** The global Marketplace grew a
  Marketplaces door: paste a GitHub repo (or any https git URL) that hosts a
  Claude plugin marketplace, and its plugins join your shelf behind a source
  filter — Vynel's own catalog and each added marketplace get their own chip.
  Third-party items are always marked community (never Official or verified),
  the add form says plainly that plugins can run code once installed, and
  everything installs through Claude Code's own plugin system, so it all
  works in Claude Code directly. Removing a marketplace takes its items off
  the shelf; chat sessions can never add a marketplace for you — that trust
  decision stays yours.

- **Connect a browser-sign-in connector with one click.** An installed
  connector that authenticates through its own website (Notion, Linear, and
  the like) now shows a Connect button: clicking it opens your browser on
  the service's real sign-in page, and the credential lands in Claude's own
  secure store — Vynel never sees or holds it, and the same sign-in works
  when you use Claude Code directly. Removing the connector signs you out
  of it first.

- **Marketplace connectors can now ask for your keys — properly.** An MCP
  server in the marketplace that needs an API key or token no longer has to
  ship with a shared secret (or nothing): the item declares what it needs,
  and Get opens a small setup step asking for exactly those values — masked,
  sent once, written only into your Claude configuration. Connectors that
  sign in through a browser (OAuth) install cleanly without credentials and
  say they still need connecting — the connect step itself lands next. Asking
  a chat session to install one of these points you to the Marketplace
  instead, so secrets never travel through conversation.

- **Desktop control asks before it touches anything.** Claude's desktop hands
  are now gated by per-app permissions you grant one app at a time, at one of
  three levels — look only, look + click, or look, click + type. In **Ask**
  mode Claude requests each app with an approval card naming the app, the
  level, and why (it appears on the desktop overlay, bottom-right); in Auto
  and Bypass it takes access as it needs it, since those modes already stand
  in for your yes. Either way nothing is touched without a recorded grant, and
  a new **Desktop access** section in the sidebar lists everything Claude
  holds with a one-click revoke.
  Behind the card sit hard walls: Claude can never type into a password
  field, clicks are confined to the window you granted (whatever app is
  actually under the cursor is what gets checked), text seen on screen is
  treated as information — never as instructions — and entering credentials,
  solving CAPTCHAs, money moves, and accepting agreements are refused
  outright. Screenshots also got sharper aim: oversized windows downscale for
  accurate clicking, and Claude can zoom into a region at full detail to read
  fine print.

- **Colleague rows got identity and receipts.** A delivered message's author
  line now reads like a profile: the persona's avatar, their name, then the
  workspace as a small icon — hover it for a profile card with the workspace's
  name. You can give each workspace its own icon in Customize (it falls back
  to the colored monogram). Beside it sits a quiet info mark: hover to see the
  run's receipts — which model did the work, how many tool calls it made, the
  tokens it used, and how long it took.
- **Chats fold into tidy turns.** Every turn in every chat now collapses to a
  single strip — the author's icon and name, the first line as a preview, and
  the time with a chevron at the right edge. Only the latest turn is open by
  default, so a long conversation reads like a clean index of what happened;
  click any strip (or its chevron) to unfold the full turn in place, and
  collapse anything you're done with. Jumping to a task's start automatically
  unfolds the turn it lives in.

- **Vynel now installs in one click, like the apps you know.** No wizard, no
  questions — run the installer and a small branded window appears (the Vynel
  mark on a dark panel, a slim progress bar), then Vynel opens itself with its
  shortcuts in place. The installer also brings the WebView runtime along, so
  setup no longer depends on a mid-install download.
- **Updates arrive silently and wait for you.** New versions download in the
  background while you work; a small "Update ready — Restart" pill appears at
  the corner and applies the update only when you click it — never a popup,
  never an interruption. The engine is shut down cleanly before the swap, and
  if anything fails the pill simply re-arms for another try.
- **The database backs itself up before every update.** Right before an
  update's migrations touch your data, a snapshot lands beside the database
  file — the one step of an update that can't be undone now has an undo.
- **The hub can serve desktop updates.** A new endpoint answers the app's
  update checks (with GitHub as automatic fallback), opening the door to
  release channels, staged rollouts, and server-side rollbacks without ever
  touching installed apps.
- **Release builds can be signed end to end.** With signing credentials in the
  build environment, the app, installer, uninstaller, and engine all carry a
  Vynel signature — the "Windows protected your PC" wall goes away once the
  certificate is live. Builds without credentials keep working, unsigned.

- **Colleagues can message you directly.** Sessions, workspaces, and agents got
  a new way to answer: send the result straight to you instead of reporting to
  whoever assigned the task. A direct answer lands in your conversation as the
  sender's own message — a titled box with the full text one click away, badged
  "Message" — and Claude never repeats it over the sender's shoulder: it quietly
  absorbs the content so follow-up questions still work. Regular reports are
  unchanged, so working chatter stays with Claude and finished answers reach
  you verbatim.

- **The working rail — everyone active, at the right edge.** One small icon
  per entity that's working right now: workspaces, sessions, agent colleagues
  (with a corner badge), and even Claude's own background replies. A gold
  breathing ring means working, an amber dot means something waits on you, and
  each icon disappears the moment its work completes. Click any icon to open
  that entity's real conversation. Idle means an empty edge — nothing to
  dismiss.
- **Click a pointer, land in the real conversation.** Task pointers now open a
  right-side panel showing the target's actual conversation — one unified
  flow, scrolled straight to the row where that task started (a brief gold
  flash marks it), with the same live streaming and composer every chat has.
  Pointers clicked inside the panel drill deeper and Back walks up; opening a
  workspace's pointer shows that workspace's own thread.
- **Message a colleague directly.** Open an agent colleague's conversation and
  just type — the same direct-message semantics as @mentioning them: the
  colleague answers with its full toolset and honest reporting identity, your
  send queues politely behind any running turn, and the old "view-only —
  @mention them in chat" note is gone.
- **Tasks track as pointers now.** When Claude hands work to a workspace or a
  session, a quiet "task → target" line appears under the hand-off message
  while the task runs — a breathing gold dot while working, "queued" while
  waiting — and clicking it opens the live view. It exists only while the task
  is in flight, so a finished task leaves just its report. Mentions land in a
  colleague's conversation as you speaking ("You · from Global"), and a relayed
  task's opening row names Claude honestly instead of masquerading as you.

### Changed

- **Approvals now truly cover every tool.** An internal permissive wildcard
  meant most of Claude's built-in tools skipped the approval layer in Ask
  mode — the check ran, but the answer was pre-decided. Every tool call now
  passes through the real approval decision (the same curated set cards by
  default, so nothing feels different day to day), and the boot warning that
  hinted at the gap is gone. The Claude Agent SDK also moved up to 0.3.231.

- **Every icon in the app speaks Phosphor now.** The interface's whole icon
  vocabulary moved from lucide to Phosphor — the set the Nocturne design
  language is drawn in — so glyphs match the design screens exactly: the
  gear-six settings, the circle-notch spinner, the robot for agents, the
  scroll for rules, carets instead of chevrons. Marketplace catalog icon
  names are untouched (they're stored data); only the artwork behind them
  changed.

- **Vynel wears its new look: Nocturne.** The whole app moved from the old
  near-black palette to the Nocturne design system — a quiet blue-grey ground,
  one violet accent used as a line and a glow rather than a flood, Inter as
  the interface typeface (bundled with the app, no font CDN at boot), thinner
  scrollbars, and ring-edged elevation. Light mode follows as a mirrored
  inversion of the same ramps. The tokens are lifted verbatim from the design
  mirror (`.claude-design/`), so future design retunes land as one reviewable
  token diff.

- **The installed app is unmistakably Vynel now.** The program is `Vynel.exe`
  (no more `vynel-desktop.exe`), the engine runs as `vynel-engine.exe` instead
  of a mysterious `node.exe` in Task Manager, and the install folder is two
  executables and one tidy `resources` folder — `engine` and `ui`, no more
  `backend`/`web`. Updating from an older version sweeps the old layout away.
- **Your data moved to a friendly home.** Everything mutable — database,
  models, logs, settings — now lives in `%APPDATA%\Vynel` instead of the
  technical `app.vynel.desktop` folder, Telegram-style. Existing installs are
  migrated automatically on first launch, and the uninstaller's "delete app
  data" checkbox covers the new home.

- **Colleague messages now read like a person talking.** A report, update, or
  direct message from a workspace or colleague renders as a regular chat
  message — the full text right in the thread, under the sender's name and a
  quiet Report/Update/Message tag. The special box treatment is gone: no side
  bar, no teaser line, no "View report" button, no popup. They're participants
  in the conversation, and now they look like it. Every delivered message
  collapses to a compact card — a kind icon (document for reports, clock for
  updates, speech bubble for direct messages), the summary line as its title,
  and a chevron at the end that unfolds the full text right in the thread,
  neatly inset. Short messages just show whole.
- **Task pointers now stay after the work finishes.** The "task → target" line
  under a hand-off no longer disappears when the task completes — it settles
  into a quiet "done" (or "failed") state and stays clickable, so you can
  always jump back to where the work happened. The gold task chip that used to
  sit under the send-message call is gone: it said the same thing as the
  pointer, twice.
- **@mention replies come straight to you.** When you @mention a colleague,
  its answer now lands in your thread as the colleague speaking — instantly,
  with no Claude narration repeating what you can already read. Claude still
  absorbs the reply quietly for context (ask a follow-up and it knows), and
  a colleague that finishes without ever replying is called out honestly.
  Reports for tasks Claude itself commissioned keep their spoken relay.

### Removed

- **The old tracking chrome retired.** Persona cards at the thread's edge,
  watch chips on rows, the activity monitor panel (trace view, agent focus,
  Background overview), Home's "Right now" band, and the title-bar button are
  gone — the pointer → sidebar → rail model replaces all of it with real
  conversations instead of mirrored views. The title-bar dot stays as a
  passive live/attention signal.

### Fixed

- **Vynel's speech no longer cuts out partway through a sentence.** Whole
  spoken lines were being handed to the sound device in one go, which it
  refuses once its buffer is full — so the rest of the line was silently
  abandoned, and Vynel sounded like it kept dropping words. Audio is now fed
  in small pieces at the speed the device can take it, so lines play through
  to the end. This affected everywhere Vynel speaks: the assistant's own
  voice and its voice in a call. Interrupting Vynel mid-sentence also stops
  it faster now, because the audio it hasn't reached yet can be dropped.

- **A workspace's main chat no longer empties when a long conversation rolls
  over.** When the assistant quietly continues onto a fresh session because the
  old one filled up, the main chat previously showed a blank conversation —
  the assistant still remembered everything, but every earlier message
  disappeared from view with no way to reach it. The main chat (workspace and
  global alike, including the sidebar thread) now reads the whole continued
  chain as one story, so a rollover is invisible: all your messages stay right
  where they were. This also restores history retroactively — conversations
  that already hit this show their full thread again after updating. The same
  fix covers conversations opened from the Sessions list: a continued chain
  opens with its whole history, not just the newest part (deliberately opening
  an earlier part still shows exactly that part).
- **Rollovers now actually carry your conversation forward.** The hand-off
  summary written at a rollover was produced by a small helper model that
  couldn't fit a huge conversation in its head — at the exact moment it
  mattered most, the summary could come out nearly empty and the new session
  started with almost nothing. The summary now runs on the same model your
  conversation used (which by definition fits it), and a summary that comes
  back malformed or suspiciously short cancels the rollover instead of
  shipping — the conversation simply continues as-is and tries again later.
- **Your own MCP servers are safe from the marketplace.** A connector you
  added by hand can share a name with a marketplace item — previously that
  made the item's card claim "Installed", and removing it from the
  marketplace deleted *your* server from the config. Marketplace installs now
  stamp their entries with an ownership marker: the card only lights up for
  entries the marketplace actually installed, installing never overwrites a
  hand-made entry with the same name (you get a clear "remove it first"
  message instead), and uninstalling — including a skill taking its bundled
  connectors with it — only ever removes entries it owns. Everything still
  lands in the standard Claude config files, so servers keep working in
  Claude Code directly.
- **Watches scan everything, and lifecycle plumbing stays invisible.** A
  monitor watching a busy event stream now scans its whole window — a burst of
  hundreds of events could previously hide the one that mattered, silently
  losing the wake forever. And the in-flight roster shows only real tasks: the
  internal hops that carry acks and reports between sessions no longer surface
  as ghost tasks labeled with message text (stopping one of those could even
  kill a report's delivery).
- **Your conversation history survives automatic continuations.** When a long
  conversation silently continues onto a fresh session mid-reply, the new
  segment now stays chained to the old one — reloading shows the whole story
  (previously everything before the continuation could vanish from view), the
  Sessions list keeps one tidy entry instead of sprouting a stray "New session"
  or a phantom duplicate, and a continued segment keeps its place in the chain
  so "conversation continued" follows correctly.
- **A finished task's report can no longer be lost or doubled.** If the app
  restarts while a report is being handed to you, the delivery now resumes
  after startup instead of silently dying (the report is the only copy of the
  result). And a task that already delivered its report never runs again after
  a late hiccup — no duplicate reports, and no confusing "it failed" arriving
  after you already received the answer (including when it merely timed out).
- **A message sent into a workspace chat no longer collides with a background
  task running there.** The two used to write the same underlying conversation
  at once (risking interleaved replies and a forked history); now your message
  quietly queues and runs the moment the task's turn settles — same rule a
  session's direct sends already followed.

### Added

- **Your agents are colleagues now.** Every configured agent has ONE continuing
  session per workspace (and one global) — @mention it and the same colleague
  resumes with its persona and memory intact, replying into your chat like a
  person: it acknowledges the task in its own words ("Received — will report
  when done"), sends interim updates while it works, and delivers exactly one
  final report. Updates and reports wear honest badges (an update never reads
  as the finished result), and every relayed message is attributed to who spoke
  it — persona rows even wear their own face (image or accent monogram) in the
  author line.
- **In-flight work shows up as people in the thread.** Each running task
  renders as a live persona card at the thread's edge — avatar, current step,
  elapsed time, an "acknowledged" mark when the child has spoken, plus Watch
  and Stop. Click Watch (or any session chip) and the panel opens the REAL
  conversation — full transcript, live streaming overlay, and a composer to
  send into the running session directly (queued sends fire in order). A
  mid-conversation continuation ("compaction") no longer freezes an open
  session view — it follows onto the fresh segment with a quiet note.
- **A Background overview, like Claude desktop's.** The title-bar presence
  dot is now a button (also Home's "See all" and the thread's "+N more
  running" line) opening a roster of everything running or queued right now,
  grouped by persona, with narration, elapsed, origin ("via Telegram", "from
  a schedule"), Watch and Stop per task — and Back always returns to the
  overview. Liveness is durable: a refresh or restart rebuilds the roster
  from the database, and tasks interrupted by a restart now say so instead
  of dying silently.

### Changed

- Reports and task hand-offs now travel ONLY through the model's own
  `send_message` (the last automatic result-harvest path is gone), each task
  chain carries a durable thread id end-to-end, and the three legacy comms
  tools (`send_task_to_workspace`, `send_task_to_session`,
  `report_to_requester`) are retired in favor of the one `send_message`.

- **The menu is now grouped — and it's yours to shape.** The sidebar reads in
  named, collapsible groups (Toolkit · Utils · Context · Connections, with
  Schedules and Marketplace standing alone) instead of one long list, with
  tighter spacing so it fits on screen. A new **Customize** entry at the bottom
  of every menu — each workspace's and the Global one — lets you hide menus you
  don't use, reorder them, move them between groups, or invent your own groups
  entirely. Hiding a menu is purely visual: Claude keeps every ability. Each
  workspace's Customize also renames the workspace and its persona (the
  @-mention follows) and picks its accent color for the tab strip.

- **Personas have faces now.** Assistant replies wear an identity icon beside
  the author name — Claude's coral spark by default, or any image you upload
  from Customize (per workspace, and one for the Global surface). Icons show on
  settled and live-streaming replies alike; messages from other personas keep
  the Claude spark. The spark itself got a crisper small-size rendering so it
  stays sharp at label size.

### Fixed

- **The notification listener now says what's actually wrong — once, not every second.** When
  the Windows notification platform dies (a stopped per-user `WpnUserService` makes every poll
  throw), the helper used to flood the api log with a useless "One or more errors occurred"
  warning each second. It now unwraps the real cause (e.g. `Class not registered, hresult
  0x80040154`), logs it once per distinct error, backs off to one poll a minute while the
  platform is down, and recovers live the moment the service is back.

- **Saying "Hey Claude" opens the overlay again — and a broken overlay build can no longer
  silence voice.** The rebuilt dev shell was panicking at launch: the auto-updater plugin
  demands its config block, which only the release overlay config carries, so every wake
  spawned an exe that died in under a second — no window, no error, daemon back to sleep.
  The shell now registers the updater only when the config actually carries it (dev shells,
  `tauri dev`, and a plain `tauri build` all run cleanly without one). And the voice daemon
  no longer trusts "the exe file exists" as "the exe works": if the overlay app exits
  immediately after launch it logs why and opens the Chrome/Edge window instead, so the
  wake is still answered while you fix the build.

- **The wake overlay no longer loads a dead port after a port change.** Tauri bakes `devUrl` and
  `frontendDist` into the desktop binary at *compile* time, so the port renumber left the last-built
  shell still pointing at the old `8999`/`8998` — and because the voice daemon prefers that binary
  whenever it exists, every wake opened an unreachable page that no amount of restarting `pnpm
  dev:full` could heal. Added `pnpm dev:desktop` to rebuild the shell, and documented which of the
  three compiled copies (dev overlay, installer, server-install payload) each port change has to
  reach.

- **Every menu now shows only its own scope's items.** The strict scope rule that already
  governed Agents, Skills, Rules, Commands, MCP Servers and Channels now covers the last
  holdouts: Schedules, Tasks (the menu and the chat-side dock), Plans, Journal, Notebook
  and Servers. A workspace's menu lists only that workspace's items — global ones no
  longer leak in — and the Global menu lists only your global items. Claude's own reach is
  unchanged: a workspace session still reads your global books and resolves your global
  agents; this is about what each menu *manages*, not what Claude *sees*.

### Added

- **A live step list under every chat.** Claude now keeps its working steps — the small
  todo list Claude Code users know — in a compact panel right above the chat input, in
  workspace chats, the Global chat, and session threads. Steps tick from open to
  in-progress to done live during the turn, you can check items off or remove them
  yourself, the list survives reloads and session resumes, and the panel disappears when
  there's nothing on it. Steps are per-session and separate from your Tasks list — tasks
  are the work, steps are how the current work is going. This also fixes a long-standing
  staleness bug: tasks Claude created or completed mid-turn now refresh in the side panel
  immediately instead of after a manual reload.

- **@ mentions, / commands, and # workspace references in every chat.** Typing `@` pops a
  picker of your agents and workspace personas: a mentioned agent picks the message up and
  runs it in the background, and its report lands back in the chat you sent it from
  (mentioning a persona like @Sarah routes the message to her workspace the same way).
  Typing `/` at the start pops your slash commands and installed skills and inserts them
  Claude Code-style. Typing `#` pops your workspaces: referencing one gives the session
  read-only tools to actually study that workspace for that message — browse its files,
  read them, get an overview — and nothing more. All three pickers open on the bare
  trigger character, filter as you type, and work with arrow keys or click. IME
  composition (e.g. CJK input) is never interrupted by the pickers or Enter-to-send.

- **New menus: Rules, Commands, MCP Servers — and Skills everywhere.** The sidebar now shows
  all five Claude-config surfaces in both Global and workspace scopes: your rules files
  (hand-written ones included, with a "Managed by Vynel" chip on marketplace-installed ones),
  your slash commands, your installed skills (now visible from Global too), and every
  configured MCP server with its scope and transport.

- **Add your own MCP server.** From the MCP Servers menu you can connect a custom server —
  a local command or a remote URL — at Global or workspace scope, with auth headers for
  remote servers. Header values are write-only: they land in Claude's config file and are
  never shown back, logged, or sent over the wire again. Remote URLs require https (local
  dev servers exempt), and adding a name that already exists is refused instead of silently
  overwriting. A note on workspace scope explains the config file lives in the project.

### Added

- **Global memory is yours, not a workspace's.** Memory added from the Global menu now
  belongs to *you* — it isn't filed into some workspace behind your back (which is what
  used to happen: the dialog quietly picked one). The Global menu stopped asking which
  workspace, because there's nothing to ask. Memories added inside a workspace still
  belong to that workspace, exactly as before. Global memories are stored and listed
  today; having Claude pull them into a workspace conversation on demand comes next, so
  the "context" tag — which auto-loads a memory into every session — is still described
  only where it actually does that, inside a workspace.

### Fixed

- **A workspace's menus now show that workspace, and nothing else.** Agents, Skills, Rules,
  Commands and MCP Servers used to list your global items alongside the workspace's own,
  which made a room's menu disagree with its folder on disk — and let one click there
  change something everywhere. Removing an MCP server from inside a workspace could delete
  it from *every* workspace, and switching a global agent off in one room switched it off
  in all of them. Each menu now lists only what that scope owns, so you manage global
  things on Global and a workspace's things in the workspace. **Nothing about what Claude
  can actually use changed**: in chat, the `@` and `/` pickers still offer everything
  available there, your global commands and agents included, and Claude's own tools still
  see the full set. (`vynel skills list` follows the menus and now shows a workspace's own
  installs; pass `--resolved` for everything available there.)

### Changed

- **Adding a memory no longer asks what "kind" it is.** The five-way Note / Preference /
  Person / Business fact / Pattern picker is gone from the add-memory dialog — tags were
  already doing that job, and doing it better, so now they do it alone. Each memory in
  the list is chipped by what it's made of instead: **Text** for a written memory,
  **File** for one imported from a document. Nothing you'd already saved changed.

- **Where you are decides where things go.** Create dialogs no longer ask "global or which
  workspace?" — open one from the Global menu and it's global; open it inside a workspace and
  it belongs to that workspace. The scope picker is gone from connecting a channel, creating a
  schedule, adding knowledge, writing a notebook book, adding an MCP server, and adding an SSH
  server (which also loses its "make it available everywhere" checkbox). To create something at
  the other level, switch there first. Rows still show a "Global" badge so you can tell an
  inherited item from a local one at a glance. One exception: memories still live in a workspace
  (global memory isn't built yet), so the Global menu still asks which workspace to file into —
  inside a workspace it just files there.

- **The side menu reads in a deliberate order now.** Home, Chat and Sessions still lead;
  below them the menu groups by what things *are* — first Claude's own resources (Agents,
  Skills, Rules, Commands, MCP Servers), then Vynel's features led by Marketplace
  (Channels, Schedules, Tasks, Plans, Journal, Knowledge, Memory, Notebook, Apps,
  Servers), then the system rows (Where Vynel runs, Account, Application). Same order in
  the Global menu and in every workspace, so the menu reads the same wherever you are.

### Fixed

- **Remote MCP servers from the marketplace now actually work.** The config writer used to
  save every server in a command-style shape Claude Code couldn't read for remote (URL)
  servers; it now writes exactly what Claude Code expects for each transport, reads old
  entries tolerantly, and never touches entries it doesn't own.

- **The Global tab now shows only global things.** Plans, schedules, tasks, journal, servers,
  notebook, knowledge, and the tasks side-panel used to show every workspace's items when
  viewed from Global; each now shows only items that actually live at the global level
  (workspace views are unchanged — they still show their own items plus global ones, and the
  tasks side-panel no longer mixes other workspaces' tasks into a workspace view). Knowledge
  and memory got real global read endpoints instead of stitching every workspace together
  client-side. Note: global memory entries can't be created yet (the storage schema pins
  every memory to a workspace), so Global → Memory shows an honest empty state until that
  ceiling is lifted deliberately. *(Lifted in [Unreleased] — see "Global memory is yours,
  not a workspace's".)*

### Added

- **Publish marketplace items straight from GitHub.** The admin portal's publish page has a
  "From GitHub URL" mode: paste a repo URL (plus optional branch/tag and folder), hit Inspect
  to prefill the form — folders following the seed-bundle layout (`vynel-item.json`) prefill
  everything — and publish. The hub resolves the ref to a pinned commit, clones it with the
  same hardened git engine the Anthropic import uses (https + github.com only), packs the
  folder kind-aware for all five kinds, and signs the artifact as usual. The credit link is
  auto-derived from the exact commit.

- **Real credits on the publish form.** The publisher is no longer hardcoded: pick an
  existing publisher (its stored name/tier/url are sent verbatim so a publish can never
  silently rename or re-tier it) or add a new one — including the "By Anthropic" official
  tier — plus a source-URL field. Fixed along the way: publishing a new version of an item
  used to silently wipe its source-URL credit link and reset its publisher; both now carry
  forward correctly.

- **Icon picker and category picker.** The free-text icon field is now a visual picker over
  a curated set of 48 icons (with a live preview of the monogram fallback), shared as one
  vocabulary between the portal and the app so a picked icon always renders. Category is a
  dropdown of the categories already in use with a "+ new category" option — and new
  categories now show up in the app as themselves instead of being silently relabeled
  "Context".

- **The hub now inspects every artifact before publishing it.** Uploaded or repo-packed zips
  are checked for path traversal, symlinks, size bombs, and entry floods at publish time —
  a bad artifact is refused with a clear error instead of shipping to installers. Repo
  folders containing symlinks are refused outright at packing time.

- **Marketplace downloads are now cryptographically signed.** The hub signs every artifact it
  publishes with a dedicated key, and the app checks that signature (plus the existing content
  hash) before installing anything — so what you install is provably what the hub published,
  even if the bytes passed through an untrusted network. Existing items get their signatures
  through a one-time backfill; older unsigned versions still install during the transition.
  `pnpm cloud:generate-keys` now prints both keypairs, clearly labeled hub vs desktop.

- **Publishing Anthropic's official items is now one click.** The admin portal's catalog page
  has an "Import Anthropic items" button: the hub itself fetches the reviewed, pinned snapshot
  of Anthropic's skills, packages each one faithfully (licenses included), and publishes them —
  no local checkout or command line needed. It's safe to click twice: anything already published
  is skipped and never overwritten. The manual `pnpm cloud:import-anthropic` still works and now
  shares the same packaging engine.

- **The hub now watches Anthropic's upstream for you.** Once a day, the cloud server checks
  whether Anthropic has changed any of the skills your marketplace republishes (against the
  reviewed, pinned snapshot). When something moved, the admin portal's catalog page shows an
  amber banner naming exactly which items changed and how to review + re-publish — nothing
  ever updates automatically; the human review stays the curation promise. The manual
  `pnpm cloud:check-anthropic` still works and now shares the same engine.

- **Plugins now update in place.** When a plugin's publisher ships a newer version, its
  marketplace card shows the same Update button skills have — one click and Claude Code's
  own plugin system replaces it, no more uninstall-and-reinstall. The version shown after
  updating is read back from Claude Code's registry, so the card always tells the truth
  about what's actually installed.

- **Rules in the marketplace.** The last catalog kind: reusable guidance files — starting
  with Conventional Commits — install as plain markdown into Claude's native rules folder
  (`~/.claude/rules/` for everywhere, the workspace's `.claude/rules/` for one project), so
  they guide the assistant in Vynel and in Claude Code alike. Every installed rule carries a
  small provenance mark, which is your protection: rules you wrote by hand in those folders
  are never shown as marketplace installs, never overwritten by an install, and never
  deleted by a removal.

- **MCP servers in the marketplace.** A new kind of marketplace item: tool connections
  (MCP servers) the assistant can use — starting with Playwright Browser, which lets it
  operate real web pages. Installing one writes a single entry into Claude's own
  configuration (`~/.claude.json` for everywhere, the workspace's `.mcp.json` for just that
  workspace), so it works in Claude Code directly too; removing it deletes that entry. No
  hidden state — the config file is the truth, and the assistant can install these for you
  when you ask.

### Fixed

- **The "Import Anthropic items" button no longer fails with "manifest not found".** The hub
  resolved its file paths from wherever the process happened to start, so in dev it looked for
  the catalog manifest (and kept its artifact files) inside the wrong folder. Paths now anchor
  to the project root regardless of how the hub is launched; existing artifact files were moved
  to the new location, and the daily upstream-drift check now actually finds the manifest too.

- **The Update button now only appears when there is truly something to download.** Built-in
  skills version with the app itself, so their cards no longer offer an Update that would
  fail; only items the cloud catalog actually carries can show one. Changing settings on a
  marketplace-installed skill also no longer risks overwriting the downloaded version's
  content with the built-in template — settings save, the installed files stay exactly as
  published.

### Changed

- **All service ports moved to a 5-digit serial block.** The whole stack now sits on one
  contiguous range: `18890` cloud hub · `18891` admin portal · `18892` engine API · `18893`
  voice daemon · `18894` web dev server (previously scattered across 8890/8891/8997/8998/8999).
  If you have a `.env` override or a bookmark pointing at an old port, update it.

- **Admin portal:** the catalog table shows each item's Publisher beside its Kind, and an
  item's Source URL (the credit line's origin link) can now be corrected right in the
  metadata form — no republish needed.

- **Skills are now simply installed or not — the pause switch is gone.** A skill is one folder
  on disk, so the old Enable/Disable state (which quietly kept a database row while the files
  were gone) has been removed everywhere: the routes, the SDK and CLI commands, the panel's
  On/Off pill, and the database column itself. Updating a skill's settings now always rewrites
  its files, and the marketplace's armed Remove button says plainly what removal means:
  "Removes it from this device and deletes its settings."

### Added

- **The Documents Pack — Word, Excel, PowerPoint, and PDF, by Anthropic.** The marketplace now
  carries its first plugin: Anthropic's document skills, installed through Claude's own plugin
  system — you click Get, and Anthropic delivers the pack to you directly through their
  channel. Once installed it works everywhere: in Vynel's assistant and in Claude Code itself,
  because it lands in Claude's standard plugin home. Plugin items wear a Plugin chip, get their
  own marketplace filter, and uninstall the same one-click way.

- **Anthropic's official skills, in your marketplace.** Five hand-picked skills by Anthropic —
  Canvas Design (posters and visual art), Theme Factory (styled slides and pages), Internal
  Comms (status reports and announcements), Slack GIF Creator, and Algorithmic Art — can now be
  published to the hub and installed with one click. They wear a **"By Anthropic"** badge, and
  every marketplace card now shows a credit line naming who made the item, with links to the
  maker and the original source. Each skill installs as its complete folder (fonts, themes,
  helpers included) into the standard `.claude/skills/` location — so it also works if you open
  Claude Code directly in that workspace. Curation stays deliberate: skills are imported from a
  reviewed, pinned snapshot (`pnpm cloud:import-anthropic`), and a companion check
  (`pnpm cloud:check-anthropic`) reports when Anthropic updates anything we republish.

- **Installed skills can now update.** When the marketplace publishes a newer version of a
  skill you have, its card shows an Update button — one click downloads the new version,
  verifies its integrity, and replaces the installed files. Running Update on an already-
  current skill safely repairs it (rewrites missing files). Two new browse categories arrived
  with this: Creative and Communication.

- **Home now shows how much Claude you actually use.** A new Usage card charts token
  usage per day, split by model ("Opus 4.8", "Sonnet 5"), over a week, two weeks, or a
  month. Hovering any day shows each model's input/output split; the input figure honestly
  includes the conversation context each reply reads. The chart updates the moment a turn
  finishes, and the same statistics exist per workspace
  (`GET /workspaces/:id/dashboard/usage`) ready for the upcoming workspace overview. The
  chart colors are new theme tokens validated for colorblind separation and contrast in
  both light and dark.

- **The model picker now loads itself — and shows each model's context size.** Vynel asks
  your Claude engine which models your account can actually run and builds the picker from
  the answer: the newest generation of each family up front (Fable, Opus, Sonnet, Haiku),
  older generations tucked behind "More models", and every row showing its context window
  ("1M" / "200K"). When Anthropic ships a new model, it appears on its own after your next
  chat — no app update needed. Until the engine has answered once, a built-in list (now
  including Opus 5 and Sonnet 5) fills in. Background helpers get the same knowledge
  through a new `list_available_chat_models` tool.

### Fixed

- **Coming back to a busy room now picks up the live reply instantly.** Switching
  workspaces mid-answer used to drop you into a degraded view: the reply crawled in on a
  slow refresh, and the thinking text, working indicator, and elapsed clock were gone.
  The chat now re-joins the running turn the moment you return — everything already
  produced appears at once, the rest streams in live, and the status line ("thinking ·
  12s" / "working · 34s") shows the turn's true elapsed time. This also makes schedule
  fires and Telegram/voice replies stream live into an open room instead of trickling in
  on a timer.

- **A failed reply now says so — permanently.** When the assistant couldn't answer at all
  (for example Anthropic's servers were overloaded — the "529" nights), the chat used to
  keep the question with no reply and no explanation after a reload, as if Vynel had simply
  ignored you. The failure is now saved into the conversation itself, so the thread shows
  what went wrong and you know to just send again.

- **Switching workspaces no longer loses the conversation you were in.** Opening a
  workspace from Home (or switching away and back) used to snap the room to its main
  continuous thread — if you'd been chatting in a fresh conversation, everything seemed to
  vanish. The room now returns to the exact conversation you left; nothing was ever
  deleted, it was just out of view.

- **Chat modes now do what they say.** Bypass truly runs everything without asking — before,
  file edits and shell commands still popped an approval card even in Bypass. Auto now leaves
  every decision to Claude's own safety check and asks only when that check is unsure — no
  hidden extra prompts, and the mode covers helpers the assistant spawns mid-turn too. Ask is
  unchanged. Background work (schedules, delegated tasks) keeps its safety net exactly as
  before: irreversible actions still pause for your approval there.

- **Thinking now actually shows up.** The Thinking picker's old "Auto" choice quietly turned
  extended thinking off for most turns — which is why workspace chats seemed to never think.
  The picker now offers the real levels only (Low → Max, default High) and always applies
  your choice, so the thought process streams in and stays readable in the transcript.

- **A conversation reads the same after a reload as it did live.** One reply used to split
  into several separate "Claude" messages when you reopened a chat; now everything the
  assistant did in a turn stays grouped under one author line, just like while it streamed.

- **The working indicator stopped vanishing mid-reply.** The live turn now shows its real
  state at the bottom of the reply the whole time — "thinking · 12s" or "working · 34s" with
  a running clock — and settles to a quiet "done · 41s" instead of blinking out. The
  indicator also no longer disappears for a beat when background activity refreshed the
  screen mid-turn.

- **A workspace chat now says so when its assistant is busy.** If a workspace's assistant is
  working on something this window didn't start — you switched tabs mid-reply, a scheduled
  task fired, or a job was routed there — the thread showed nothing at all while the Home
  screen said "working". The workspace chat now shows the same working strip the global chat
  has: "Ryan is working…" plus one chip per routed task, each with Watch and Stop.

### Added

- **Updating Vynel updates your server too, without losing anything.** When the desktop app
  updates, it notices if the engine on your server is older and says so. One click re-ships
  the matching engine: it installs alongside the running one and swaps at the end, so your
  conversations, memory, and files stay exactly where they were — verified on a real server.
  Server engines now ship with every release, so the app always has the right one to install.

- **Your server can sign in to your Claude account, without Vynel ever holding the key.**
  When Vynel's engine runs on your server it needs to sign in to Claude there. Vynel shows
  the sign-in link, you approve it in your browser as usual, and paste the code back — the
  server's own Claude program stores its credentials, exactly as it would if you'd typed the
  command yourself. Vynel carries the link out and the code in and keeps nothing. It uses
  your existing subscription, and the row tells you plainly when a server still needs signing
  in.

- **You can now choose where Vynel runs, from a settings screen.** A new "Where Vynel runs"
  section shows whether Vynel's engine is on this computer or on a server you own, lets you
  add a server (Vynel installs itself over SSH and narrates each step in plain language —
  "Checking the server…", "Sending Vynel's engine…", "Ready"), and switches between them with
  a restart. A failed install says exactly what was wrong with the server rather than showing
  an error code. Sign-in details are entered once and encrypted; nothing shows them again.

- **The desktop can now reach a remote engine as if it were local.** The second half of
  "run Vynel on my server": a secure tunnel that makes the engine on your server appear at
  the same local address the app always uses — every window, chat, and API call works
  unchanged, no reconfiguration anywhere. The connection rides SSH (encrypted end to end),
  quietly signs every request with the install's access token (the interface never sees it),
  and reconnects by itself after network blips. Proven live: the full web UI, API, and
  health check served through the tunnel from a real Linux server. The app's port also got
  one single home in the code with a build-time guard, so a future custom port is a
  one-line change.

- **Vynel can now install its engine on your server.** The foundation for "run Vynel on my
  server": given SSH access, Vynel provisions a Linux machine end-to-end — checks the server
  is suitable (and says exactly why not if it isn't), uploads the engine (integrity-verified),
  installs it as a proper system service that restarts on failure, locks it behind a
  per-install access token, and confirms it's healthy — all in about a dozen seconds, with
  live step-by-step progress you can follow. Server credentials are sealed with the same
  encryption as SSH servers and never leave the machine; proven end-to-end against a real
  Linux server.

- **The engine is ready to run headless behind a lock.** For the coming "run Vynel on my
  server" mode: the engine now answers a small open health check (liveness + version) while
  everything else can be locked behind a per-install access token — other people with accounts
  on the same server get a firm 401, never your data. Voice knows it lives on your desktop:
  a remote engine says so honestly instead of trying to speak on the server. Proven live on
  the Linux build: health open, everything else locked without the token.

- **Vynel's engine can now be built for Linux servers — the first step toward "run Vynel on
  my server."** The release pipeline cross-builds the full backend payload for linux-x64 from
  a Windows machine and proves it boots for real (WSL smoke test in the release gate). Three
  independent guards make a broken cross-build impossible to ship silently: native binaries
  are checked byte-by-byte for the right platform and architecture, wrong ones are re-fetched
  or fail the build loudly, and the verifier re-checks everything. Headless servers also
  gained a file-based master-key vault (`VYNEL_MASTER_KEY_FILE`) so the engine boots without a
  desktop keyring. Bonus: the audit removed 258 MB of dead weight that platform filtering had
  been silently letting into every payload.

- **Vynel now speaks to terminals and to Claude Code.** A new `@vynel/cli` npm package (built
  by `pnpm release:cli`, verified by `release:cli-verify`) carries two doors into a running
  Vynel: the `vynel` command-line client for shells and scripts, and `vynel mcp` — an MCP
  server that plugs Vynel's 84 tools straight into Claude Code with one line:
  `claude mcp add vynel -- npx -y @vynel/cli mcp`. The package is fully self-contained and
  ships no readable source, same as the desktop build.

- **Vynel now updates itself.** On launch the app quietly checks the official releases page
  (github.com/kafijunior/vynel-releases); when a new version exists it asks — "Update now?" —
  downloads, installs with a small progress bar, and restarts on the new version. Every update
  is cryptographically signed and the app verifies the signature before installing, so a
  tampered download can never get in. Proven live: an installed 0.1.0 offered, downloaded, and
  became 0.1.1. Publishing a release is one command for us (`pnpm release:desktop --publish`).

- **Vynel now cleans up after itself — always.** However the app dies — closed normally, killed
  from Task Manager, or crashed — Windows itself now guarantees the background engine and
  everything it started die with it. No stray processes holding files or ports, which also
  means upgrades can't fail on "file in use" (exactly the installer error this fixed).
  Launching Vynel twice now brings the running window forward instead of starting a second
  copy, and both the app shell and its engine write proper log files, so "it didn't open" is
  finally diagnosable.

- **Installing Vynel is now six times faster.** The installer sheds everything the app can
  never run — binaries for five other platforms, browser-only bundles, a test corpus, type
  files — cutting the download from 170 MB to 123 MB and a clean install from eleven minutes
  to well under two. Semantic search (the embedding engine) was proven working end-to-end on
  the slimmed build.

- **Vynel installs like a real Windows app — the first installable version.** `pnpm
  release:desktop` produces `Vynel_0.1.0_x64-setup.exe` (~170 MB): double-click, install, done —
  no Node, no repo, no prerequisites. The installed app carries its own pinned runtime and the
  compiled backend beside the exe, keeps all your data (database, models, settings) in your
  user profile where upgrades and uninstalls can't touch it, boots in about a second, and
  closes clean — no stray processes left behind. Dev workflows are untouched: the bundling
  config lives in a release-only overlay, so `tauri dev` and checkouts never need a payload.

- **Vynel can now be built as a real, publishable product.** One command compiles the entire
  backend — every Vynel package — into a single minified bundle (no readable source ships to
  users, the same protection model VS Code, Slack, and Claude Code itself use), assembles it
  with its runtime pieces (a pinned Node, the native modules, the database migrations, the
  instruction content, the built desktop UI) into a self-contained payload, and a second
  command proves that payload boots and serves on a machine that has never seen the repo.
  Measured: 1.3-second cold start. This is Phase A of the release plan (`docs/release-plan.md`)
  — the foundation the Windows installer, the `@vynel/cli` npm package, and the
  install-on-your-server mode all build on.

- **Claude now replies to Telegram the way it speaks on voice — deliberately.** When a message
  arrives from Telegram, Claude is told exactly where it came from — a direct chat, or a group
  and who in it asked — and answers by *sending* a reply there, the same way a voice question
  is answered by speaking. Group answers post in the group, threaded onto the message that
  asked; direct chats get a normal reply. What lands on your phone is what Claude chose to
  send — its working-out stays in the app transcript, where you can read the full "via
  Telegram" conversation. (Voice already worked this way; Telegram now matches.)

- **Claude's playbook shelf grew from three books to nine.** Six new built-in playbooks guide
  how Claude builds software for you: turning a first idea into a researched plan and phased
  roadmap (`starting-a-project-from-scratch`), the backend application architecture
  (`node-app-scaffold`), a typed SDK generated from the API and wired into every app
  (`node-sdk-from-api`), the Vue/Nuxt frontend with shared UI and server-state rules
  (`vue-nuxt-app-scaffold`), exposing an app's capabilities to AI assistants
  (`node-mcp-server`), and when work earns a plan with tasks versus a single task
  (`task-planner`).

- **Reports now arrive as real messages from whoever did the work.** When a workspace or
  session finishes something you delegated, its report lands in the parent chat as a compact
  incoming note — the sender's name, a "Report" tag, its workspace color, and a one-line
  summary — with a **View report** button that opens the full, formatted result in a dialog
  (the same way plans open). No more walls of text in the thread, and no more reports dressed
  up as if *you* had typed them.

- **Watching delegated work now follows the chain, level by level.** The message that sent a
  task carries a live status chip — "letterman — working…", then "done · report delivered" —
  that stays after the work finishes and opens the live view of that workspace. If the
  workspace handed part of the job to a session, that session's own watch chip is right there
  inside the opened view, one click deeper; Back walks you up. Each room only ever shows its
  own direct children — the way the pipeline actually flows.

### Changed

- **The Notebook page is now just YOUR books.** The built-in playbooks Claude consults are its
  own working material — they no longer clutter the Notebook page. You see and manage only the
  books you wrote; Claude keeps reading both.

- **Only real reports travel.** A workspace or session reports back by *deciding* to send its
  result — Vynel no longer copies a finished task's last chat message upward as if it were a
  report. That's the end of premature "done!" notes arriving while the real work was still
  running. Reports also carry a delivery note under the hood so the receiving assistant always
  knows a result arrived from delegated work — not from you — and relays it up the chain
  instead of stopping halfway.

- **Claude can now manage your agents and the marketplace from chat.** Ask for a specialist
  helper and Claude can browse the curated catalog, install it, build a custom agent from
  scratch, tune its prompt and tools, switch it on or off, or remove it — all through
  conversation. The marketplace opened up the same way: Claude can browse what's available
  for a workspace, tell you what an item does, and install or uninstall it for you. It can
  also read which capabilities (memory, knowledge, tasks…) are on in a workspace, so "why
  don't you remember things here?" gets a real answer — though switching capabilities on or
  off deliberately stays a you-only control, as does resolving approvals.

- **Ask mode now truly asks.** Approvals follow one simple rule: in **ask** mode, anything
  destructive — deleting an agent, removing a knowledge source, uninstalling a marketplace
  item, registering a new workspace, or acting on your desktop — pauses for your approval
  card first; in **auto** and **bypass** modes Vynel's own tools run without interruption.
  Previously the card never appeared in ask mode for Vynel's tools at all, and a couple of
  tools asked in every mode. Claude's everyday self-tools (saving a memory, adding to
  knowledge, keeping your task list) no longer ask anywhere — bookkeeping shouldn't knock.

- **Tabs! Keep several rooms open at once.** A new tab strip sits under the title bar: the
  first tab is always your Global chat, and every other tab is a workspace room. Click `+`
  to open a room in its own tab, use the little arrow on a tab to point it at a different
  workspace, and close tabs you're done with. Each tab remembers its own place — the section
  you had open, the conversation you were in — so you can genuinely multitask: leave the
  bakery room mid-task, answer something in Global, and come back to exactly where you were.
  Your set of open tabs survives restarting the app. (The workspace switcher that used to
  live in the title bar is gone — the tabs are the switcher now.)

- **Tabs got prettier — and yours to color.** Tabs are bigger now and all the same size,
  like a browser. Hover a tab and its controls appear: the arrow to switch that tab to a
  different workspace (each room in the list shows its color dot) and the close button.
  Open the arrow menu and you'll also find **Tab color** — pick from the palette to paint
  a tab so your rooms are recognizable at a glance, or leave it on Automatic. Your picks
  are remembered, and the active tab wears its color as an underline.

- **A calmer menu bar.** Four menus became two. **Vynel** now holds New workspace along
  with Settings, Account, and Quit; **View** is just the things that change how the window
  looks — Show navigation, the theme switch, and the Command palette — each with a little
  icon showing what it affects. The old Assistant and Go menus are gone; everything they
  held still lives in the command palette (⌘K), the tab strip, and the sidebar.

- **Browser view (parked — not in this release).** A browser panel that put a live page
  beside your chat, with an **Ask Claude** button to send a note about the page straight to
  your draft. Two versions were built — an embedded frame, then a real native web view for
  the desktop app — but the native page draws above everything else in the window, and
  keeping it from covering dialogs and menus proved fragile enough to be worth redoing
  rather than shipping. The globe button is gone for now; the work is kept and will return.
  The fixes it produced along the way — approval cards and questions docking to the side of
  the chat, and every dialog reporting itself so nothing can hide behind it — stay.

- **Menus finished their icon column — and shortcuts speak your platform.** Every row in
  the Vynel menu now carries its icon (Settings and Account wear the same icons as the
  sidebar, so the vocabulary matches everywhere), and shortcut hints show what your
  keyboard actually has: Windows and Linux see "Ctrl+Shift+N", Macs see "⌘⇧N".

- **Zoom channel groundwork (parked as "coming soon").** The full Zoom Team Chat adapter is
  built — WebSocket event listening (no public URL needed), markdown replies, group-chat
  support riding the same approve-a-group flow, auto-detected account ID — but live testing
  showed Zoom doesn't currently deliver chatbot messages over WebSocket event subscriptions,
  so the Zoom card sits as "coming soon" in the connect dialog until Zoom exposes the event.
  The connect dialog now shows each channel's own credential form, and transcripts can mark
  messages that arrived "via Zoom".

- **Claude can now join your group chats.** Add your Telegram bot to a group and @mention it
  once — the group appears in the channel's Manage dialog for you to approve or ignore
  (no chat IDs to copy). In an approved group, Claude answers when @mentioned or replied to,
  threads its answer onto the asking message, and tells you who in the room asked. Each group
  has its own access setting: everyone in the group, or only your allowed senders. Approval
  cards never post into a group — those stay in the app, where only you can decide.

- **Channels wear their real brand marks and got a Manage door.** Every channel row now shows
  the channel's actual brand icon (Telegram's paper-plane in Telegram blue), a clear
  Healthy / Attention / Paused pill, and a Manage action. The new Manage dialog lets you
  rename a channel, pause and resume it, and curate exactly who's allowed to message the bot
  (add or remove allowed senders by their Telegram user ID) — all of which previously required
  disconnecting and starting over, or wasn't possible at all. One catalog now drives how every
  channel kind presents across the app, so future channels (Discord, Zoom) slot in cleanly.

### Changed

- **Channel lists are strictly scoped.** The global menu lists only global channels; a
  workspace's drawer lists only that workspace's own — a channel no longer appears in both
  places (and the redundant scope chips are gone).

- **Claude can now hand you a plan to review, right in chat.** When Claude creates or reshapes
  a plan it can link it in its reply; clicking opens a review card showing the day, the
  details, and the plan's work items — with live status tiles you can check off without
  leaving the conversation. The same card opens from the Plans list and from a task's
  "View plan" chip.

- **Every list row now has View · Edit · Delete.** Tasks, plans, and journal entries all carry
  the same fixed-width action cluster (rows line up column-clean): View opens the full detail
  dialog (a task's shows its linked plan; a journal entry's shows the whole text), Edit opens
  a proper edit form (title/detail for tasks; title/day/details for plans; text/day for
  journal entries — journal editing remains yours alone, never Claude's).

- **Plans — date-wise planning next to your task list.** Each plan belongs to a calendar day
  (title, details, a date, and open / in-progress / done status), and tasks can now link to a
  plan — so "what is Friday for, and what's left of it" is one question. Claude keeps plans
  current through new tools (`create_plan`, `update_plan`, `complete_plan`, `list_plans`,
  `list_my_plans`), and `list_tasks` can list one plan's work items. Like tasks, plans exist per
  workspace and globally, you keep the delete key, and provenance (Claude vs you) can't be
  spoofed. Toggleable per workspace as the new **Plans** capability (on by default). A **Plans
  view** joins the menu on both surfaces — days grouped newest-first (Today / Tomorrow /
  Yesterday labels), an inline "Plan a day…" composer with a date picker, the same
  status-cycle tile tasks use — plus `vynel plans list|add|done|reopen|move|delete` in the CLI.

- **A daily work journal Claude writes and reads.** Dated entries record what happened and what
  was decided each day; when Claude picks work back up it reads the recent entries to understand
  the flow. New tools: `add_journal_entry`, `list_journal_entries` (day or date-range reads),
  `list_my_journal_entries`. The journal is **append-only for Claude** — editing or deleting
  history is yours alone (panel/CLI doors). Toggleable per workspace as the new **Journal**
  capability (on by default). A **Journal view** joins the menu on both surfaces — entries
  grouped by day, a "What happened today…" composer, writer chips (Claude / you), hover-delete
  (your door only) — plus `vynel journal list|add|delete` in the CLI (day + date-range reads).

- **Claude can now use the desktop by hand — click, type, scroll, drag at a point.** When Claude
  is working from a screenshot (an app with no readable accessibility tree), it can now act the way
  a person does: click where it sees, type, press keys and shortcuts ("enter", "ctrl+c"), scroll,
  and drag — via a new `act_on_desktop` tool. Pass the window name and coordinates are read straight
  off that window's screenshot (top-left is 0,0), so "click the button I can see" just works. It
  stays behind the same off-by-default safety switch as the element-based actions and asks for
  approval before every action. (Element-addressed `act_on_app` remains preferred when the
  accessibility tree is available.)

### Changed

- **The desktop overlay stays put while Claude works, and the approval never hides.** The
  "Claude is using your desktop" overlay used to blink shut between steps; now it stays open through
  the whole desktop sequence and shows the full running log (scrollable), hiding shortly after
  Claude is done. When Claude needs your approval, the card is pinned at the top — it can't get
  buried under the step log anymore.

- **Finished work now reports back as a real conversation, not a dropped note.** When a
  workspace or session finishes something you (or your assistant) handed to it, the result no
  longer just appears as a detached message — the receiving conversation actually *processes*
  it: the report arrives as an incoming message from that workspace or session, and the
  assistant reads it, acts on it if needed, and replies with what it means for you. Reports also
  travel the whole chain now — a session created by a workspace reports to that workspace, which
  can pass the real result (findings, numbers, file paths — not just "done") up to your main
  assistant with a new `report_to_requester` tool. Channel replies (e.g. Telegram) still arrive
  immediately, exactly as before.

- **Workspaces now work in parallel.** Hand tasks to two different workspaces and both run at
  the same time (up to three at once) instead of silently queuing one behind the other. Tasks
  for the same workspace still run in order — a workspace never trips over itself. And a
  workspace that's busy on a handed-off task now shows it live: its presence dot lights up and
  its chat thread grows in real time, without needing the Watch panel.

- **The "hand a task to a workspace" tool has a clearer name.** `route_to_workspace` is now
  `send_task_to_workspace`, so its card reads as plain words about what's happening.

- **Voice answers instantly acknowledge you.** The moment your spoken command is captured, the
  assistant says a quick contextual line — "Checking your schedules.", "On it." — while the real
  answer is being worked out, so you always know you were heard. For longer jobs (routing work to
  a workspace), it also says what it's about to do before doing it.

- **Voice conversations feel snappier and readable.** The pause that ends a spoken command
  dropped from five seconds to three; the overlay shows "Thinking…" while your question is in
  flight instead of freezing on your own words; long spoken replies start sounding after the
  first sentence is synthesized (the rest renders while it plays) instead of waiting for the
  whole answer; and the floating Jarvis overlay got a translucent glass card behind the orb and
  captions so they're readable over any screen.

### Added

- **A Sessions menu, and you can chat with any created session.** Home, Chat, and Sessions are
  now plain entries at the top of the sidebar menu. Sessions is a simple list — in a workspace,
  its conversation and its sessions; globally, the assistant's own created sessions — and
  clicking one opens it as a normal chat, the same view the ongoing conversation uses. Sessions
  the assistant created are directly chattable (a message sent while it's mid-task queues and
  goes next), and older continuation segments are readable with chat continuing at the newest
  one. This replaces the old "past conversations" side panel.

### Changed

- **Watch works everywhere now.** Workspace conversations offer the same Watch chips the
  assistant's chat has; an agent working directly in any conversation can be watched live and
  its recorded activity reviewed after; a task running inside a created session shows a live
  chip named after that session; and clicking a linked session opens its live view.

- **One watch panel for everything.** Watching a handed-off task, a session, or an agent now opens
  the same side panel — and you can drill from a session into the agent working inside it and back.
  Watching a session also gained agent drill-down it never had.

- **Watching a session now shows its history.** Opening Watch on any session starts with the
  conversation so far — not an empty pane that only fills when the next turn begins — and joining
  mid-turn catches up instead of freezing on a partial reply.

### Added

- **Claude can set a watch and get woken when something happens.** Instead of checking back
  over and over, Claude can now say "tell me when the migration finishes" or "tell me every
  time the dev server crashes" and get on with something else — when it happens, that
  conversation picks itself back up with the news. Watches belong to the conversation that
  set them, whether that's your main chat, a workspace, or a session Claude spun up, and
  every one has an expiry so nothing lingers forever.

- **Sessions talk to each other through one clear channel.** Handing work to a workspace,
  giving a task to a session, and passing a result back up used to be three separate tools
  with three different shapes. They're now one — Claude picks where the message goes and
  writes it deliberately, rather than having whatever it happened to say scraped out of the
  chat and forwarded. Results read like results now, and you won't see the same finding
  arrive twice.

- **A session Claude spins up now has the same abilities as the one that created it.**
  Previously a spun-up session could be given work but had none of the tools its parent had
  — one kind had no tools at all and couldn't even report back what it found. It now
  inherits its parent's toolset and runs under the same approval mode you picked.

- **Claude can now check on the work it handed off.** When you ask for something that runs in
  the background — a task sent to a workspace, or to one of its own sessions — Claude got back
  a receipt it couldn't do anything with. It can now list everything it started (what it was,
  where it went, whether it's queued, running, finished or failed) and pull up the full result
  of any one of them. So "did that finish?" gets a real answer instead of a guess, and Claude
  can pick work back up where it left off.

### Fixed

- **Claude can no longer get stuck waiting on a tool that never finishes.** An audit of every
  tool the assistant can call turned up three places where a stall meant waiting forever with
  nothing to show you — no error, no card, just silence. Creating a session now gives up (and
  cleanly cancels) if the new session doesn't come up; the first search of your knowledge or
  memory no longer waits indefinitely on the one-time search-model download (it says so and
  keeps downloading in the background); and Vynel's tools served to outside apps now time out
  with a message that says what happened. Zoom calls got the same treatment. Everything else
  checked out — hand-offs return immediately, apps already force-stop, and unanswered approval
  cards were already being cleaned up.

- **A workspace can now route handed-off work into sessions.** Asking your assistant to have a
  workspace send work into a created session used to dead-end — the workspace's background run
  didn't carry the session tools and reported them "dropped". Background runs now have the same
  session tools the workspace chat has, so the whole chain (assistant → workspace → session)
  works and the tools stop appearing to come and go.

- **Handed-off tasks no longer knock the assistant's tools offline.** Running a task in a
  workspace (or a created session) used to strip that conversation's Vynel tools — the next time
  you chatted there, the assistant would insist "the whole Vynel integration is disconnected"
  until an app restart. Background task runs now carry the same toolset as scheduled runs, so
  the conversation's tools survive every kind of turn — and a handed-off task can finally use
  them (tracking its work on your task list, reading memory) while it runs.

- **The assistant now knows which models it can pick for a handed-off task.** The
  "send task" tools advertised a free-form model field, so the assistant had to guess valid
  model names (and a wrong guess silently fell back to the default). The tools now present the
  exact list of available models to choose from.

- **A refused action now reads as refused.** When you deny an approval card, the tool's card
  settles in a distinct "denied" state instead of looking like the tool broke, and the approval
  record now links to the exact tool call it gated — every decision you make (approve, deny,
  time out, cancel) is stamped on the action it applied to.

- **No more cards stuck "running" forever.** If the app was closed, crashed, or lost its
  connection while a tool or spawned agent was mid-run, its card stayed in a live "running"
  state indefinitely — even days later. Any run cut short now settles to a quiet "cancelled"
  state: immediately when the turn is interrupted or the stream drops, and at the next app
  start for runs orphaned by a crash or exit.

- **Voice replies you can actually hear, every time.** Three silent-voice failure modes are
  closed: (1) a `speak` from a typed chat or a scheduled task while a Jarvis window or app tab
  was merely *open* (no live voice session) used to be dropped while reporting success — the
  daemon now asks that connected client to play the line, and only falls back to its own
  speaker when nobody's connected; (2) on a long-running brain session the model would drift
  back to text-only replies and ignore the voice directive — every voice turn now restates the
  speak instruction right on the message, where recency keeps it in force; (3) if the model
  still answers in prose without calling `speak`, the overlay speaks the first sentence of the
  text answer instead of ending the turn in silence.

### Added

- **Claude picks the right power per task.** When handing work to a workspace or a spawned
  session, Claude can now choose the model and thinking effort for that task — a cheap fast
  model for routine chores, full reasoning for hard problems — instead of one-size-fits-all.

- **Workspaces can spin up sessions too.** Session spawning works at both levels: a
  workspace's assistant can create helper sessions grounded in that workspace (its files,
  memory, and skills), and their results come back into the workspace's own conversation.
  From the global chat you can also ask for a session grounded in a specific workspace.

- **Claude can now spin up its own sessions.** Ask for something big and Claude can create
  a dedicated session for it — a full conversation with its own memory and its own context
  window — name it, hand it tasks, and keep working while it runs. Spawned sessions appear
  in the Sessions page like any other (named, metered, watchable), several can work in
  parallel, tasks to the same session run in order, and results come back to your chat as
  short summaries. Claude also sees each session's context usage, so it can decide when to
  start a fresh one instead of overfilling an old one.

- **A Sessions page that shows everything Claude is doing.** A new "Sessions" section in the
  sidebar lists every conversation — the Assistant itself, each workspace, all sorted by last
  use — with a context meter on each one, a live dot when it's working, and a Watch button
  that streams any running session's activity in real time.

- **You can see conversations continue past the context limit.** When a conversation nears
  its limit (~85%), Vynel quietly continues it in a fresh session — and now you can see it:
  a continued conversation expands into its chain ("continued at 83% → current"), telling the
  story of how you never hit a wall.

- **The composer shows your context and thinking controls, like Claude desktop.** A small
  ring beside the message box fills as the conversation uses context (ticking live during a
  reply, resetting when a conversation continues fresh), and a new Thinking picker
  (Auto/High/Medium/Low) controls how much reasoning Claude applies — remembered across
  restarts.

- **Claude's desktop senses are live — and Discord-class apps finally read.** The desktop tools
  (notifications, open apps, reading an app's screen, and the opt-in click/type actions) are now
  wired into every global-brain turn — web chat, voice, and Telegram alike. Reading an Electron
  app like Discord got a rebuilt wake: the screen-reader signal Chromium actually checks, verified
  window focus with a retry that defeats Windows focus-stealing prevention, the right window
  picked among an app's many helper processes, and a poll that returns the moment the app's
  interface is readable instead of a fixed guess. When a wake still can't finish, the tool now
  says exactly what to do ("click the window once and retry") instead of returning nothing.

- **A screenshot fallback for apps that can't be read.** New read-only `screenshot_app` tool
  captures one app window as an image — without touching focus — for canvas-drawn or stubborn
  apps where the accessibility tree stays empty. Element-reading stays the primary path.

- **An attention overlay while Claude uses your desktop.** A small always-on-top window appears
  the moment Claude touches the desktop, narrating each step in plain words — "Reading Discord",
  "Pressing 'Save' in Notepad" — with recent steps, the approval card for any mutating action
  (decidable right there, synced with the main window), and a Stop button. It appears
  bottom-right without stealing your typing, lingers a few seconds after the last step, then
  hides. Works even when the turn came from voice or Telegram with the main window closed,
  riding a widened activity feed that now narrates per-tool steps and approval bells for every
  turn surface (the workspace-turn drill-down gets the same signal for free later; delegated
  workspace runs keep their existing trace stream).

- **Agent activity survives the reply.** A spawned agent's activity — its tools with their
  status lights and its running narrative — is now recorded as it streams, so it's still there
  after the reply finishes, after a reload, and whenever you reopen the task Watch panel or an
  agent's focused view. Watching a task after the fact now shows what each agent actually did,
  not just its final report — the same "look at it any time" behavior tasks have always had.
  (The agent's raw tool outputs deliberately stay out of the record — the card's final report
  carries the result.)

- **Background summarization is structurally sandboxed.** Every quick internal summarization
  call (the task-reply distiller, the session hand-off summary) now runs through one shared
  dispatcher that is physically incapable of using tools, writing session history, or running
  more than a single turn — the safety walls are built into the mechanism instead of being
  options each call site must remember.

- **Tool cards and approval cards got readable.** A tool card's Input/Result panes now show
  pretty, syntax-colored JSON — and a tool that answers with a serialized object is unwrapped
  to the object itself, not a wall of escaped quotes. Approval cards lead with the assistant's
  own explanation of what it's doing ("Inspect sibling derived-state schemas") as the title, a
  shell approval shows the actual command as a terminal line, and any remaining details render
  as colored JSON — nothing is hidden, it's just finally legible.

- **Task reports read like a colleague, not a log dump.** When a workspace finishes a task you
  handed off, the global chat now shows a short reply — the outcome and key results in a few
  sentences — instead of the workspace's entire working report scrolling down the thread. The
  full report is still there behind the task's Watch view. Tasks that came in over Telegram get
  the same treatment: a message actually shaped for Telegram (short, plain text), not a wall of
  markdown. Already-short reports are delivered as-is.

- **Agent cards stay compact in the chat.** While an agent works, its card shows a single live
  line — the tool it's running right now — instead of the full activity list growing down the
  thread (several agents in parallel used to flood the conversation). The full trace, live or
  finished, is one click away behind the card's Watch chip.

- **Watch your agents work.** When Claude spawns an agent (in any chat), you can see what it's
  doing — a live line under its card names its current action, and every Agent card on a
  hand-off carries a "Watch" chip opening a focused side view of the full activity: each tool
  with a status light plus the agent's running narrative (with a Back arrow returning to the
  task when you drilled in from the global chat). Works from the workspace chat and the global
  chat alike. Before, the agent was a blank "Agent · 15ms" card while its tool calls flooded the
  chat as if Claude itself ran them and its words never appeared at all. Agents also now run to
  completion inside the reply — the engine's new background default could leave them silently
  killed mid-task when the reply finished.

- **Queue messages while Claude works.** Typing mid-reply no longer bounces — Enter (or the send
  arrow, now sitting beside Stop) queues your message, visible as removable chips above the
  composer, and each one sends automatically as the previous reply finishes. A queued follow-up
  lands in the same conversation the first message just started. After you press Stop (or a turn
  fails), the queue parks instead of blindly firing.

- **You can actually stop things now.** A hand-off to a workspace shows a stop square on its
  working chip and a Stop button in its live view — a queued task is cancelled outright, a running
  one is interrupted and recorded as "stopped by the user" (its half-finished answer is never
  passed off as a completed report). The global chat's Stop button now also stops the work
  server-side — before, it only hid the reply while Claude kept running (and could keep handing
  off tasks) behind the scenes.

- **Your agents now ride every conversation.** User-level agents (installed or hand-made) were
  only available inside workspace chats; the global chat — and Telegram — now spawn them too,
  with the same lifecycle.

### Changed

- **Vynel's core operating instructions now live as editable files.** The always-on prompts that
  set how the assistant behaves — the workspace assistant's ground rules, the global brain's
  routing recipe, and the voice-reply style — moved out of the code into plain markdown under
  `packages/instructions/session-instructions/`. Editing a file changes how that scope behaves
  (after an app restart), no code change needed. The wording is byte-identical to before — this is
  groundwork for managing these instructions directly, not a behavior change.

- **Engine updated.** The Claude Agent SDK moved forward 16 releases (0.3.197 → 0.3.213). Also
  verified end-to-end: workspace chats load your project's CLAUDE.md, skills, agents, rules, and
  settings from disk exactly like Claude Code does.

### Fixed

- **Approval cards can no longer get stuck.** If the app restarts while approvals are waiting
  (very common in development), the old cards used to linger un-clickable — approving them
  failed with an error and the agent view froze. Now deciding such an orphaned card always
  clears it, and every restart sweeps leftover pending approvals immediately instead of
  letting ghosts sit for many minutes.

- **Your chosen mode and model stick.** The composer's session mode (Ask / Auto / Bypass) and
  model silently reset to defaults on every reload — they now persist, which is why "bypass"
  sometimes seemed not to work after a restart.


- **Claude's replies keep their shape while streaming.** A response that uses tools now renders
  live exactly as it will read afterwards — each part of the answer with its tool activity
  attached in place — instead of one long text block with all the tool cards piled underneath
  that silently reformatted after a reload.

- **Task chips now say what the task is.** The "Watch…" chip on a hand-off reply and the
  working banner above the chat both name the actual work — "vynel · Set up the login page" —
  instead of a generic label, and still open the live view on click.

- **The chat now updates in real time, wherever a conversation happens.** Message Claude from
  Telegram and the reply appears in the open app as it's written — no reload. Open a second
  window or tab and both stay live: whichever one starts a conversation, the other follows along.
  Scheduled runs that write into a workspace thread now show up live too. While Claude is busy
  answering somewhere else, the chat says so ("Replying on Telegram…") instead of silently
  making you wait. Under the hood this is a new always-on activity feed from the Vynel engine to
  the app — the first real server push — plus a fix for a glitch where a response could briefly
  appear twice while streaming.

### Changed

- **Every feature screen refreshed and consistent.** Channels, Schedules, Knowledge, Memory,
  Notebook, Agents, Marketplace, and Account are now clean cards with clear hierarchy, roomier
  spacing, and a tasteful splash of color — and every pop-up (connect a channel, add a memory,
  create a schedule, write a book, new workspace…) shares one polished dialog that dims the
  background, traps focus, and closes on Escape or a click outside.

- **A desktop-app shell.** The window now has a proper desktop layout: a title bar with drop-down
  menus (Vynel · Assistant · View · Go) and minimize/maximize/close controls, a Home/Chat toggle with
  a workspace switcher beside it (switch between Global and any workspace, or start a new one), a clean
  left navigation you can drag to resize (its width is remembered), a status line along the bottom, and
  a **⌘K command palette** to jump anywhere or run an action by typing. Feature sections
  (Channels, Schedules, Knowledge, Memory, Notebook, Marketplace, Agents) now live in the sidebar
  rather than a hidden drawer.

### Fixed

- **Dialogs and overlays no longer wash out in light mode.** Modal and overlay backdrops now dim the
  page behind them in light theme — they previously used a near-white scrim that bleached everything,
  leaving pop-ups looking flat and low-contrast.

### Added

- **Claude can manage your servers — without ever seeing your passwords.** Add a server
  (Vynel Pro) in Settings-style form — name, address, how to sign in — and your password or key
  is encrypted on the spot and never shown again, not even to Claude. From then on you can just
  ask: "check how much disk space is left on my server", "restart the website" — Claude runs the
  commands through Vynel's own secure connection, and your Servers section keeps a plain-language
  history of what happened ("Checked disk space"). If a server's identity ever changes (a classic
  warning sign), Vynel refuses to connect and tells you. Claude also gets a built-in playbook on
  careful server work: check before changing, prefer reversible steps, verify after.

- **Run your apps from Vynel — and let Claude run them for you.** Each workspace now has an
  Apps section (Vynel Pro): register the things your project can run — a web app, an API — and
  start or stop them with one click. A green dot shows what's running, "Open in browser" jumps
  straight to it, and a live log view shows what the app is saying (crashes are called out with
  why). Claude can set these up itself: ask it to run your project and it figures out the right
  command, registers the app, starts it, and checks the logs to confirm it came up healthy.
  Quitting Vynel cleanly stops anything it started. Also on the command line (`vynel apps`).

- **Telegram now hears about things that happen while you're away.** Scheduled routines that
  deliver to a channel actually arrive there now, and when Claude is waiting on your input a
  short nudge ("Claude needs your input: …") reaches your Telegram so you know to open the app.
  Old, long-stale messages from before this landed are quietly skipped — nothing floods in on
  first start.

- **Claude can now ask you things with a proper form.** When Claude genuinely needs your
  preference or details mid-task — which tone, which server, how many — it no longer buries
  questions in chat text. A gentle "Claude needs your input" card appears, and answering opens a
  step-by-step wizard: one question at a time with progress dots, or flip the "View as form"
  switch to see everything on one page. Claude patiently waits for your answers before
  continuing; "I'll decide later" lets it carry on without them. (Also fixed along the way:
  the standing guidance for features like the Notebook never actually reached workspace
  conversations — now it does.)

- **A task list Claude keeps for you.** Ask for anything with more than one step and Claude now
  tracks it as tasks you can see: what's planned, what it's working on right now, and what's done.
  Every workspace has its own Tasks section (plus a global list), a checklist icon in the title bar
  opens a slide-in panel with a badge counting what's open, and the Home dashboard shows the list
  with everything recently completed. You can add, check off, reopen, or remove tasks yourself too —
  and turn the whole thing off per workspace from Capabilities. Also available from the command line
  (`vynel tasks`).

- **Paste or attach files and images in chat — and Claude actually receives them.** Paste a
  screenshot, drop a PDF onto the message box, or pick files with the attach button; they ride the
  message in the main chat and in every workspace room (images, PDF, Word, Excel, PowerPoint, text,
  markdown, CSV, HTML, JSON — up to 6 files, 5 MB each). Sent messages show what rode along as quiet
  chips; unsupported or oversized files are declined in plain words before anything is sent.

- **The chat mic now types for you.** The little mic in the message box is dictation — talk and your
  words appear in the box for you to read and send yourself. Nothing is sent until you press Send.
  Talking WITH Claude stays one click away: the mic in the top bar opens the voice overlay, which
  always appears mid-screen (the floating desktop orb now centers itself too).

- **Memory has tags — and the special "context" tag Claude keeps for you.** Every memory can carry
  a few short labels: pick from suggestions (context, preference, person, project, decision,
  routine, reminder, note), reuse what you've coined before, or type a new one. Tag a memory
  **context** and it becomes part of what Claude always knows in that workspace — every fresh
  conversation starts from those facts, and Claude is instructed to keep them current (updating a
  standing fact instead of piling up duplicates). A memory can also be imported straight **from a
  file** — pick a document and its text is remembered, tags and all.

### Added

- **Installed agents are visible files now — just like skills.** Installing a marketplace or
  curated agent writes a readable `.claude/agents/<name>.md` file (in the workspace, or your home
  folder for user-level installs), clearly headed "Managed by Vynel". The file appears on install,
  disappears on removal or disable, and can never overwrite an agent file you wrote by hand — a
  name clash refuses the install with a clear message instead. Hostile package names can't forge
  the file's permissions either; every value is neutralized before it touches disk.

- **The marketplace now lives in two places — and items know where they belong.** A new Marketplace
  on the main menu shows items meant for YOU (installed once, available everywhere), while each
  workspace's marketplace shows items meant for that project — and an item can be published for
  user level, workspace level, or both. The marketplace pages also use the full window width now.

- **Manage hub users from the admin portal.** The Accounts page lists every account with its role,
  plan tier, and status — change a role or tier from a dropdown, or disable an account (two-step
  confirm; disabling also signs the account out everywhere, immediately). The catalog page's
  publish button is now "Add Marketplace Catalog".

- **The marketplace is a real storefront now — with search and filters.** Items render as cards
  (icon tile, kind and Official badges, description, category and version) in a responsive grid,
  with a search box that matches names, descriptions, and categories, filter tabs by kind, and an
  Installed toggle. A filtered-empty shelf says "nothing matches" with a one-click clear — never
  pretending the catalog is empty.

- **Remove what you added — channels and marketplace items.** Every connected channel row now has
  a remove control, and every installed marketplace item (skills and agents alike) has a Remove
  button that flips the card back to "Get". Both use a two-step confirm — the first click arms a
  "Sure?", only the second acts — because disconnecting a channel means re-entering its bot token,
  and removals aren't undoable. Removing an item only ever touches the marketplace-installed copy:
  an agent you built yourself can never be swept up by it, even if it shares a name with a catalog
  item.

### Added

- **The Notebook — curated playbooks Claude reads when the task calls for them.** A new Notebook
  section (global menu and every workspace) holds two shelves: **verified books** shipped with the
  app — starting with a web-app build playbook and a plain-language communication guide — and
  **your own books**, written right in the app. When you start a matching task, Claude checks the
  shelf and follows the book's current guidance instead of guessing from stale training knowledge.
  Claude can only *read* books, never change them; verified books can't be edited by anyone in the
  app, and your books are yours alone. Toggling the Notebook capability off removes both the tools
  and the suggestion to use them.

- **Publish new marketplace items straight from the admin portal.** The catalog page gained a
  "Publish item" button opening a full form — pick the kind (skills and agents install in the app
  today; other kinds publish but stay hidden until supported), fill in the details, attach the zip,
  and publish as a draft or live. The `pnpm cloud:publish` command also now reads the project's
  `.env` on its own instead of failing when the admin token isn't exported in the shell.

### Changed

- **Every agent change now leaves a durable event trail.** Creating, editing, or deleting an agent
  records an event in the same transaction as the change itself (deleting previously ran outside
  any transaction) — the same bookkeeping every other feature already had, groundwork for sync and
  activity feeds.

### Added

- **Marketplace agents — install a ready-made helper, not just skills.** Items of kind "agent"
  published to the hub now appear in the app's marketplace with an Agent badge, and Get installs
  them as a real agent (persona, model, working style) marked as community-sourced. Every install
  is integrity-checked against the catalog's fingerprint before anything is read, a malicious or
  oversized package is rejected before it can waste memory, and no community agent can skip the
  approval card on irreversible actions — that floor is enforced by the app itself, not by the
  package. Other kinds (MCPs, rules, plugins) stay hidden until they're actually installable.

- **A real admin portal for the marketplace hub.** `apps/cloud-admin-web` is a small web app where
  hub admins sign in with their own account and manage the catalog visually: every item (drafts
  included) in one table, metadata editing, pull-from-distribution and restore with a confirm step,
  version history with integrity fingerprints, publishing a new version by picking a zip, and
  provisioning accounts/roles — no more curl for day-to-day catalog work. Validation errors from
  the hub now arrive as the same plain `{code, message}` shape everywhere, so the portal (and any
  future client) can show exactly what was wrong.

- **The marketplace hub now has real admin machinery (the portal's backend).** Hub accounts can
  carry an admin role — granted once with the server's own key, revocable instantly, and checked
  fresh on every request so a removed admin loses access immediately. Admins can list the whole
  catalog including drafts, edit an item's details, and pull an item from distribution ("yank") —
  which hides it from browsing and blocks new installs on the spot, while people who already
  installed it keep a working copy. Yanking is reversible; published versions themselves are never
  altered or deleted, so every install stays verifiable forever.

### Changed

- **Internal reorganization — nothing changes in how the app behaves.** The session engine's
  delegation machinery (routing a task into a workspace's brain, running queued delegations,
  surfacing approval cards, reading a request's trace) moved from the api app into the
  `@vynel/session` package where the rest of the session engine lives, and the marketplace hub's
  publish/download rules (the 10MB cap, the tamper-proof version check, the tier gates) moved from
  its web routes into the registry package. Every behavior was verified unchanged; the upcoming
  admin portal builds directly on these relocated pieces.

### Fixed

- **Knowledge folders actually index now — and keep indexing after a restart.** Two invisible gaps
  made "add a folder" look dead: folder watchers were never re-opened when the app restarted, and
  the background embedding step never ran in the desktop app at all (it lived in a worker process
  nothing launched). Both now run inside the app itself: sources re-index on boot (catching files
  changed while the app was closed), file changes index live, and search embeddings generate within
  a minute — for knowledge *and* memory. Each knowledge source row now shows its real status ("12
  files indexed · updated 2m ago") instead of sitting silent, and single FILES can be added to the
  vault, not just folders.

### Added

- **The knowledge vault and Claude's memory are now manageable in the app — globally or per
  workspace.** Knowledge: point Claude at any folder with a real folder browser and it indexes
  everything readable inside for search — sources live globally ("searchable everywhere") or in one
  workspace, and can be removed with one click. Memory: read everything Claude remembers (the global
  menu shows every workspace's memories with scope chips) and add your own — a note, a preference, a
  person, a business fact, a pattern. Both sections invite the first item instead of showing an
  empty pane.

- **Connect channels and create schedules from the app — on the global menu and in every
  workspace.** Channels: a guided connect dialog (Telegram with the @BotFather walkthrough; Discord
  marked coming soon) with a "where it lives" choice — global or one workspace — and empty states
  that invite the first connect. Schedules: tell Claude what to do and when — **once** (in 15
  minutes, in an hour, tomorrow 9 AM, or any picked moment) or **repeating** (daily / weekly on a
  weekday / monthly on a day, at your chosen time). Schedule rows read in plain words ("Daily at
  9:00 AM · next Fri 9:00 AM") and pause/resume with one click.

### Fixed

- **The "+" next to the workspace switcher now does what it looks like it does — create a
  workspace.** It used to silently start a fresh conversation (often invisible on an empty room).
  Starting a new conversation moved to where conversations live: the "+ New" button atop the
  Conversations panel.

### Added

- **Messages remember how they reached Claude.** A message you speak through the voice channel now
  wears a quiet "via Voice" mark beside it in the conversation (Telegram messages likewise), so a
  transcript mixing typed, spoken, and channel messages stays legible at a glance. Applies to
  messages from now on — history from before this release has no origin recorded.

- **The chat opens with a real arrival moment, and your assistant is Claude by name.** An empty
  conversation now greets you personally under Claude's coral spark — "Good morning" with your name,
  the channels Claude is reachable on (Telegram health, Voice with the wake phrase), and your
  workspaces as clickable cards wearing their accent colors with their manager's name ("vynel — with
  Ava"). Every reply is signed the same way: the assistant speaks as **Claude**, a workspace's
  manager by their own name ("Ava · vynel"), and saying "Hey Claude" now genuinely wakes the voice
  daemon. Workspace rooms get the identical welcome with their manager's mark in the workspace color,
  and their composer asks "Ask Ava for anything…".
- **The conversation scrolls like Discord.** Long history loads in pages — the newest 100 messages
  render instantly and scrolling to the top reveals more without losing your place. New replies
  follow at the bottom only while you're already there; if you've scrolled up to read, a floating
  "Jump to latest" pill takes you back instead of yanking you. Your own sends always land you at the
  latest message, and the whole thread got wider room to breathe.
- **Tool activity now reads like Claude Code, not JSON.** Each tool the assistant uses is a compact
  chip — "Wrote CLAUDE.md **+16** · 2.2s" — that expands into the real artifact: the file path in a
  header bar with a copy button, a unified diff with green/red +/- gutters and syntax highlighting,
  a terminal view for commands, the spoken sentence for `speak`. Assistant-internal tool ids
  ("mcp__vynel__route_to_workspace") show as plain words ("route to workspace").

- **Work is color-coded by workspace.** When the assistant hands a task to one of your workspaces,
  its report comes back wearing that workspace's own accent color: a colored bar down the message,
  plus a matching "Watch" chip and "Working in…" banner — so at a glance you can tell which workspace
  each result came from. Each workspace gets a stable, distinct color automatically (gold stays
  reserved for "the assistant is working here").
- **Voice is now a real communication channel — say "Hey Vynel" and talk to it like a person.** A
  new `speak` tool lets the assistant *choose* to answer out loud: voice requests run on the fast
  Haiku model, which does the work and then speaks a short, natural reply (no more reading a wall of
  markdown aloud). It hears you through the browser's accurate speech recognition and waits a real
  pause before deciding you're done — so you can think mid-sentence without being cut off. The reply
  plays in one consistent voice with no echo, and the same `speak` capability means any part of the
  assistant (a scheduled morning briefing, a finished background task) can talk to you when it makes
  sense. Needs the voice daemon running (`pnpm dev:voice`) plus Chrome or Edge / the desktop overlay.
- **A first-launch setup wizard — a fresh install now opens to a guided welcome instead of a dead
  screen.** The moment the app detects setup isn't finished (the API's first-launch gate), a
  full-window wizard takes over: say hello, tell Vynel your name and timezone, name your first
  workspace, seed your assistant's first memory about you, pick starter skills, optionally connect
  Telegram, and optionally schedule a morning briefing. Every step is driven by the real onboarding
  API — closing the app mid-setup resumes exactly where you left off, and "Start over" restarts the
  run. When the last step lands, one click opens the app with everything already in place.
- **Create a workspace from the app — the switcher's new "New workspace…" row.** A dialog names the
  workspace and walks your real folders (drives, up-navigation, live listing) to pick the existing
  directory it should live in; creating it selects it immediately. No more asking the assistant (or
  the CLI) just to add a room.
- **The Jarvis overlay is now a real desktop overlay — transparent, always-on-top, speaking in
  Vynel's own voice.** A thin Tauri shell (`apps/desktop`) hosts the orb as a frameless translucent
  card that floats above everything: saying "Hey Vynel" launches it (or reveals it instantly if it's
  already running, hidden), it transcribes live, and the reply is spoken with the daemon's Kokoro
  voice — the same voice whether the overlay or the native loop answers (browser speech is the
  automatic fallback if the daemon is away). Closing or silence hides the card; the next wake brings
  it back. A live probe on WebView2 unblocked this: Tauri's webview ships a fully working
  Web Speech recognizer (Azure-backed, punctuated finals), so the overlay keeps Google-grade STT.
  The Chrome app-window remains the fallback surface on machines without the built desktop app.
- **The Jarvis overlay — "Hey Vynel" now opens a floating voice window with Google-grade
  transcription.** The always-on daemon keeps waking locally (Moonshine — your room's audio never
  leaves the machine), but the command session now runs in a small floating Jarvis window: the Web
  Speech API (Chrome/Edge's cloud recognizer) transcribes what you say with a live word-by-word
  transcript in the orb, the brain answers over the same turn stream the chat uses, and the reply is
  spoken sentence-by-sentence while it's still being written. Say "Hey Vynel, …" — the window pops to
  front (launching if needed; the same-breath command survives the launch), follow-ups need no re-wake,
  and ~15 s of silence puts it away and hands the mic back to the daemon. With no browser around, the
  daemon still answers natively (Moonshine + Kokoro) exactly as before. The in-app mic button drives
  the same session in a page overlay; the scripted voice demo is gone.
- **`@vynel/voice-engine` — Vynel can now speak AND hear, on the CPU with no Python** (via
  `sherpa-onnx-node`, native ONNX). Model-agnostic contracts — `VoiceEngine` (text-to-speech) with a
  `SherpaVoiceEngine` backend (Kokoro's 11 natural voices, or a small VITS/piper voice) and
  `SpeechRecognizer` (speech-to-text) with a `SherpaSpeechRecognizer` backend (Moonshine) — plus pure
  config mappers and a `FakeVoiceEngine` for tests. `pnpm voice:fetch-models` downloads a model into a
  gitignored `.models/`; `pnpm voice:smoke` speaks a WAV; `pnpm voice:bench` reports the real-time factor
  of each model on your machine. **Measured on CPU: Moonshine transcribes ~70× faster than realtime,
  piper synthesizes ~14×** — ample headroom for the always-on loop. A `VoiceActivityDetector`
  (silero-VAD) segments a continuous mic stream into complete utterances.
- **`@vynel/voice-daemon` — the always-on "Hey Vynel" background service.** A standalone sidecar that
  listens on the mic (native audio via `node-cpal`, no browser), wakes on "Hey Vynel", holds a multi-turn
  conversation with the brain over its HTTP API, speaks the answers, and falls back asleep after a stretch
  of silence — entirely on the CPU, no Python. Built with an echo-defense gate (the mic stays shut until
  the speaker has actually finished, so it never hears itself) and a no-barge-in v1. The LuxTTS/Chatterbox
  voices plug in later behind the same engine contract.
- **Routed tasks can now DO work — with your approval (surface-up).** A task the brain routes to a
  workspace no longer auto-denies irreversible actions: the action pauses, an approval card appears in
  the app (always) *and* in the channel the request came from (Telegram — ✅/❌ buttons, or reply
  "approve" / "deny <reason>"), and whichever surface decides first resumes the task. Unanswered cards
  time out (~10 min) via a new reaper service, so a parked task always finishes with a report. The
  brain's own carded tools (e.g. creating a workspace from Telegram) reach the channel the same way.
- **The Ask/Auto/Bypass mode now governs the brain and routed tasks.** A global-chat turn carries the
  composer's mode; the brain's own tools respect it, and any task it routes inherits it (stored on the
  delegation job) — the mode picks which tools pause for approval.
- Channel approval cards for routed tasks name the acting workspace ("Write — in vynel"); routed agents
  are steered to read-only tools for read tasks; the Watch panel no longer shows the same answer twice.
- **Watch a routed task live, as it works.** A routed task's activity now persists the moment it happens
  — the task appears in the workspace chat instantly, the reply grows as it streams, and every tool call
  shows up as it runs (previously nothing appeared until the task finished, and tool calls weren't kept
  at all). The "Working in *{workspace}*…" indicator is now a clickable Watch pill that opens the live
  trace panel mid-run (with tool cards), and the workspace chat updates itself while a routed task runs.
  Watch chips only appear where they point at work happening elsewhere — the workspace's own transcript
  no longer shows them on its routed exchanges.

- **Watching is now truly live.** The Watch panel rides a streaming connection: text arrives
  token-by-token, tool calls appear the instant they start, and a "Waiting for your approval" pill shows
  while an action is paused on your decision. Polling remains only as an automatic fallback if the
  stream drops.
- **See delegated work happen.** When the brain routes a task to a workspace, the global chat now shows
  a live "⚡ Working in *{workspace}*…" indicator (polling the in-flight delegations) and keeps the thread
  live so the workspace's report appears within seconds of completing. A report's "Watch *X*" chip opens
  a right-side panel that fills in the delegation's condensed trace (task → workspace reply → report) as
  it runs. (Previously the report only surfaced on window-focus and the chip 404'd.)
- **The assistant can create workspaces (MCP tool).** `register_workspace` — a brain-surface, mutating
  MCP tool bound to the global-root turn — lets the user set up a new workspace straight from the global
  conversation ("set up a bookkeeping workspace in C:\Users\me\Bookkeeping"); it fires an approval card
  before creating. Introduces an `x-mcp.rootSurface` flag so a user-scoped route can be routed to the
  brain's toolset without living under `/routing/`.

- **The complete HTTP API surface — every remaining vertical landed** (109 paths → 131 typed SDK
  methods across 22 namespaces, 33 MCP tools): workspaces, memory, agents, capabilities, users,
  files, **chat (12 routes + the `chat-turn` SSE stream)**, **root (global chat reads + the
  `global-root-turn` SSE stream + delegation trace drill-down)**, **routing (task dispatch to
  workspaces + proactive channel sends, executed by a new boot-time delegation service)**,
  providers (install/auth status), **onboarding** (new decoupled `@vynel/onboarding` leaf, 5 wizard
  routes, first-launch gate — production 412s non-onboarding routes until setup completes),
  approvals workspace pending/audit + approval-rules, and the net-new `GET /dashboard/overview`
  aggregate for the Home screen.
- **Typed responses everywhere:** every JSON 200/201 now declares its real wire shape (previously
  75 of 83 operations were description-only, so the generated SDK returned `Promise<never>` for
  everything except knowledge — the UI's typed data layer now actually holds repo-wide).

### Changed

- **Approval cards in the chat now say what's being asked.** The inline card classifies the action
  with the same taxonomy the server records — "wants to run a command", "wants to create a file" —
  and risky kinds (shell commands, deletes, outgoing email) get the danger treatment instead of the
  generic headline. The inline card and the corner notification can no longer disagree.
- **The Watch panel reads at a glance.** Watching a delegated task now shows a live status pill
  (working / done / failed), the instruction that started the task styled as its own card, and a
  gold "waiting for your approval" banner while the task is paused on you. Escape closes the panel.
- **Desktop UI now runs on the real API, not demo data (M7).** Deleted the hand-written demo
  namespaces and the scripted turn player; `workspaces`, `dashboard`, and the whole chat vertical
  (session reads + live turns + approvals + interrupt) now hit the generated SDK. Live turns stream
  over the real `chat-turn` / `global-root-turn` SSE via a typed `parseAs:'stream'` POST fed through
  a pure frame parser; approvals decide through the real API and the stream reflects the resolution.
  Global chat is one continuous conversation (`root.*`, no history list); workspace chat is `chat.*`.
  The workspace drawer's feature sections (skills, channels, schedules, knowledge, marketplace) read
  their real per-domain lists, each fetched only while its section is open. The composer's model
  picker is the real curated `CHAT_MODELS` allowlist, and the chosen model rides on every turn. The
  workspace files area browses real files lazily (one directory listing per folder, fetched on
  expand), and the editor reads and saves to real disk — truncated and binary files open read-only
  so a partial buffer can never overwrite the file. Contracts `ChatSessionResponse.workspaceId` is
  now nullable and `ChatToolCallResponse.toolInput`/`toolOutput` optional, matching the wire.
- **The demo data layer is fully removed** — `apps/local-web/src/demo/` no longer exists; the desktop
  UI runs entirely on the real API. (The Jarvis voice overlay stays a scripted animation until the
  voice engine lands — that is UI, not data.)

### Fixed

- Namespaced-SDK generator: path params are typed from the OpenAPI spec (a literal-enum path param
  like capabilities' `capabilityId` previously broke the generated client's typecheck).
- Home dashboard: global-root conversation rows carry `workspaceId: null` on the real wire; the
  view now routes them to the global chat (the demo had used a sentinel id).

- **`@vynel/ui` — the shared component library** (design tokens + components for every Vynel surface).
  Cool-slate dark/light token system with ONE reserved accent — gold means "the assistant is running or
  needs you" (presence dot, live pulses, approval cards, stream cursor). Components: SegmentedTabs,
  IconButton, EmptyState, PresenceDot, MarkdownText (sanitized), MessageRow, ThinkingBlock, ApprovalCard,
  CodeBlock (lazy shiki highlighting + line numbers), ToolCallCard (tool-aware: Read → highlighted file
  content, Edit → before/after diff, Bash → terminal, unknown → payload panes), ToolCallList ("Read 2 files"
  grouping).
- **`apps/local-web` — the desktop web UI** (Vue 3 + Vite + Pinia + vue-query over the typed SDK).
  Custom titlebar (menu · history toggle · workspace switcher · new conversation · tabs · presence dot);
  **continuous-first chat** — Chat and each Workspace open straight into the one ongoing conversation,
  with session history opt-in behind a toggle and a persistent menu panel whose items (Application,
  the workspace feature sections) render on the canvas; the approval notifier — pending approvals
  surface bottom-right as decidable cards on ANY view (polls the live approvals API).
  Runs on a **contracts-typed demo seam** until the chat/workspaces routes land: hand-written demo
  namespaces on the SDK client + a scripted `ChatTurnEvent` player (thinking, text, tool calls, a real
  approval pause, interrupt) — swap = regenerate SDK + delete `src/demo/`.
- **Workspace tab, Home dashboard, and the Jarvis voice demo** (`apps/local-web`, demo-phase). The
  Workspace room: workspace switcher (persisted), its own sessions + chat, a files panel, and the hidden
  menu's seven feature sections (Skills / Channels / Schedules / Knowledge / Marketplace demo lists typed
  by the real contracts; Memory / Agents arrive with their APIs). Home: recent conversations across
  every scope, workspaces with their manager personas, upcoming schedules, and the approvals note. Voice:
  the `VoiceOrb` (pure-CSS gold presence, six states) behind the titlebar mic — a scripted demo loop
  until the voice engine module lands; the future Tauri overlay window mounts the same orb.

- **`@vynel/session` — the workspace turn machinery** (Slice 2b). The workspace chat runner (`startChatTurn`),
  the seed-fresh swap primitive (`runSeededSwapSession`), the primary-conversation resolver, post-turn
  continuity-application (link the durable "primary" session + pressure-bridge swap when context fills), and the
  per-turn capabilities prompt composer. This completes the `@vynel/session` package — global-root core
  (Slice 2a) + workspace machinery + resolvers + composers + continuity.
- **`@vynel/chat/repositories`** subpath export — surfaces the chat repositories for cross-package composition
  by the session tier, the faithful analog of the former kernel `@vynel/db/repositories/chat`.
- **Global approval queue — backend foundation** (`@vynel/approvals`). Global-root ("brain") approval cards now
  **persist** (they were previously dropped and lost to the stream — the root cause of stuck/never-shown
  approvals); `listPendingApprovalsForUser` lists every pending card for a user across all sessions/workspaces +
  the brain; and `resolveApproval` is **user-scoped**, so a workspace-less card can be answered from any surface
  rather than only timing out. This is the backend the "answer approvals from any screen" experience runs on
  (the HTTP routes + notification UI arrive with `apps/api`).

- **Approval queue HTTP surface** (`apps/local-api`) — `GET /approvals/pending` + `POST /approvals/:id/decide` over
  the global-queue backend, with a typed SDK (`client.approvals.listPending()` / `.decide()`). Withheld from MCP —
  approvals are the sensitive human-in-the-loop path an agent must never self-approve.

- **`@vynel/voice`** — the stateless voice-relay functional core (wake-word, audio segmenting, turn-taking,
  barge-in, sentence buffering, spoken-summary + fire-and-notify), folded into `turn-taking/` + `relay/`.
- **`@vynel/skills` + skills HTTP API** — the skills leaf (install / uninstall / enable / disable / settings /
  list / sync-with-provider) with a typed SDK (`client.skills.*`, 8 methods) and 2 read MCP tools
  (`list_available_skills`, `list_installed_skills`). Install/uninstall stay off MCP (host-disk mutations).
- **`@vynel/channels` + channels HTTP API** — the channels leaf (connect / disconnect / enable / allowed-senders /
  history, Telegram adapter) with 9 routes, `client.channels.*` (9 methods) and 2 read MCP tools. Responses strip
  the bot token + poll cursor; the connect route (carries the token) is withheld from MCP.
- **`@vynel/schedules` + schedules HTTP API** — the schedules leaf (create / update / enable / disable / delete /
  list / runs / templates) with 8 CRUD routes, `client.schedules.*` (8 methods) and 3 read MCP tools. A schedule
  is **recurring** (a cron expression) or **one-time** (a `fireAt` timestamp — "remind me in 20 minutes" — fires
  once then disarms); create exposes both. An explicit `scheduleKind` column now names the two kinds.
- **Schedules FIRE end-to-end** — the ③ agent-turn MCP binding (`composeSessionMcpServers` + the in-process
  `vynel` server built from the api's own `app.request`) plus a per-minute boot poll service and a
  `POST /schedules/:id/fire-now` route. A due (or manually-fired) schedule now runs a real headless workspace
  turn with the route-derived Vynel tools attached. Fire-now is SDK-only — a turn is never itself an agent tool.
- **Global-or-workspace is API-reachable** — user-scoped `/channels` + `/schedules` route groups (create with a
  `scope` field, list-all, full id-ops) sit alongside the workspace-scoped routes, so a _global_ channel or
  schedule can be created, listed, and managed. Every id-op authorizes by `userId` (tenant-safe).
- **`@vynel/marketplace` + marketplace HTTP API** — the table-less marketplace leaf (browse + get catalog items,
  annotated with per-user install-status) and `client.marketplace.*` (2 methods). Install-status is composed at the
  route from `@vynel/skills` (kept off MCP — its reads are the join of already-exposed skills tools).

### Changed

- **`@vynel/skills` / `@vynel/channels` / `@vynel/schedules` own their schema + repositories** (moved from the
  `@vynel/db` kernel — the vertical-slice shape). All behavior-neutral relocations (drizzle "No schema changes").
- **`channels.workspaceId` and `schedules.workspaceId` are now nullable** — a channel or schedule can target a
  **workspace** or be **global** (null). Baseline-folded (pre-release, zero data). The workspace-scoped fire path
  keeps its owner-check unchanged; a global schedule fires without a workspace.
- **Cross-feature seams decoupled via dependency injection** — as they became `@vynel/<feature>` leaves, channels
  and schedules stopped importing sibling leaves: the approval-resolve (`channels`) and turn-firing
  (`startChatTurn`, `schedules`) calls are now injected through their existing `Deps` seams (the app/worker
  composition layer binds the real functions), and cross-domain event types resolve through `@vynel/contracts`.
  Their poll-tick worker bodies are deferred to the session app-wiring.

- `@vynel/approvals` now owns its schema + repositories (moved from the `@vynel/db` kernel — the vertical-slice
  shape). `approval_requests.workspaceId` is now nullable (holds workspace-less brain cards). Behavior-neutral
  schema relocation (drizzle "No schema changes").
