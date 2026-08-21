# Vynel — Vision (the product compass)

> **Read this first.** It is *what* Vynel is and *why*. `architecture.md` is the *how*;
> `restructure-research.md` is *where the code stands*. Every product decision tests against this doc.

---

## 1. In one line

**Vynel takes a non-technical person from "I want to use AI" to "I'm running my work on AI" —
without ever opening a terminal — by wrapping Claude Code's full power in a control surface they can
see, understand, and trust.**

## 2. Who it's for

Non-technical knowledge workers and small operators — small-business owners, freelancers, solo
professionals, creators. They feel the AI wave and want a real assistant, but they will never type
`npm install -g`. **Easy to install, everything built in.** Vynel is emphatically *not* for
developers — they already have Claude Code and Cursor.

Concretely: **our community members.** They believe AI can help them, but every time they've tried —
Claude Desktop, Claude Code, OpenClaw-style assistants — they hit a console they can't read, skills
and project structures they can't manage, agents they don't understand, and they **give up**. The
most powerful tool in the world is sitting right there and they can't use it. Vynel exists for
exactly these people: it puts Claude Code's full power into their *daily work* without asking them to
become technical. **Every product decision tests against one question: would a non-technical
community member understand this screen, this word, this flow — without anyone explaining it?**

## 3. The gap we close

To reach Claude's real power today (tools, memory, skills, channels, scheduled tasks) a person must
find a terminal, install Node, run npm, do a token dance, edit `.mcp.json` / `settings.json` /
`CLAUDE.md`, and register bots by hand. Non-technical users bounce at step one. **Vynel deletes all
of it** and surfaces that power as clickable, controllable products.

## 4. The thesis

Vynel is to Claude Code what Discord is to WebRTC. We **do not fork or replace** Claude Code — we
launch the user's installed runtime, drive it through the official SDK, and present its power as an
experience layer. Every Anthropic model or tool improvement, we inherit for free. The runtime is a
backend choice behind the `AiAgentProvider` seam; the user's relationship is with **Vynel**.

## 5. Principles

- **Never fork Claude Code** — inherit every upgrade.
- **The user never sees a terminal** — install, auth, and config are invisible.
- **Defaults protect; power is opt-in** — every irreversible action passes one approval card.
- **Everything the assistant knows — and has done — is visible and editable.** This is the headline
  differentiator.
- **We curate, we don't just aggregate** — trust tiers, a seal that means something.
- **Provider-agnostic** — Claude first; other runtimes slot in behind one seam, never a rewrite.
- **Local-first, cloud-later — built for both from day one.** Every row carries `userId`; every
  repo is dialect-agnostic.
- **A shape that never breaks — reusable "multiverse."** Every feature is a self-contained, reusable
  piece over a small stable core; the base stays legible and hard to break. (→ `architecture.md`)

---

## 6. What we're building — the building blocks

### Session — the brain ("one brain, many hands")

The root is a **limitless, continuous session**. The user always feels like they're talking to *one*
assistant — never juggling sessions or context windows.

- **Global Root** — the primary. **Every channel** (voice, text, Telegram, workspace) talks to it.
  The user can ask it anything; it **routes** — to a workspace, a spawned session, or a spawned
  agent — and it handles tasks and workflows (→ agents / sessions / workspace sessions) while
  smartly saving its own context.
- **Workspace Root** — like the global, scoped to a workspace. It takes work from the user *or* from
  the global's spawned sessions/agents, holds **durable long-running context**, and reports back to
  the global.
- **Spawned sessions & agents** — the *hands*. Every child reports to its parent.
- **Renew before compact.** Root/primary sessions are **renewed before they hit the context limit** —
  the assistant distills the thread, seeds a fresh session with it, and continues, so the
  conversation never hits a "this chat is full" wall. When it needs more, a session can pull from
  other sessions, **memory**, and **knowledge** to rebuild context.

### Memory — never lose it

The context and facts that must persist for a user/workspace, held in the database and **backed up so
the user never loses them — even after a reset or a fresh Windows install.** Memory is visible,
editable, and source-attributed; the assistant proposes new memories, the user approves. Memory is
the durable thread that survives across session renewals.

### Knowledge — the vault

The user builds a **knowledge vault** by pointing Vynel at directories to index — at **workspace
scope** (that workspace) or **global scope** (a personal base across all their workspaces). Claude
reads and works over that knowledge base (ingest → chunk → embed → semantic search) so answers are
grounded in the user's own content.

### Schedule

The user sets **one-time or recurring** tasks — morning briefings, weekly summaries, watches — that
wake the assistant at the right time and deliver the result through a channel.

### Channels — Telegram + Voice

How the user reaches the assistant *outside* the app.

- **Telegram** — a per-user bot with an allowlist.
- **Voice** — an **always-on background voice** that listens and speaks. It's a *channel*
  into the same one brain — not a separate product. The endpoint is: you just talk to it.

### Marketplace — an authenticated backend

A **backend API the user authenticates to**, serving the latest marketplace: **agents, skills,
rules, MCPs, and plugins.** Curated with trust tiers; install at user or workspace scope.

### Plugins — extend the assistant

Installable capabilities the assistant gains. The first is **desktop-control** — letting Claude Code
observe and (with approval) act on the desktop: windows, notifications, click/type. Plugins and MCPs
attach to a session through **one uniform descriptor**, so a new capability surfaces everywhere at
once.

---

## 7. Surfaces — one brain, three ways in

Same core, thin surfaces. Easy install, all features built in.

- **Desktop app** — the primary experience: the UI plus the always-on voice overlay, hosting
  or talking to the local daemon.
- **Local API** — the daemon (the brain process) running on the user's machine.
- **CLI** — for users who just want a feature from the command line, not the full app.

And the rule that ties them together: **every capability — every MCP tool — is exposed in the API,
in the CLI, and attached to the agent SDK. Defined once, surfaced everywhere.** A "desktop request"
is simply the desktop-control plugin's tools attached to the running session.

---

## 8. The line we hold (non-goals)

- **The tool is free; workshops fund it.** We earn by *teaching* — hands-on workshops that take a
  community member from install to running their work on AI. Vynel itself is never the thing we
  sell, so the product is never bent toward extraction; it is bent toward the person learning it.
  Accounts and access come through the community platform (workshop membership), not a checkout.
- **Never resell AI models.** The user pays Anthropic; we never sit in that path.
- **Never replace developer tools** (Cursor, Claude Code itself).
- **No free-for-all marketplace** — curation is the value.
- **No silently auto-generated skills** run on a user's machine without review.
- **Not "set it loose to run your business."** It is user-directed; every irreversible action still
  passes the approval card. The brain is powerful because the user stays in command of it.

---

## 9. Where we are

Most of this is **already built and tested** in the old repo — we are moving it into this clean
modular-monolith shape module-by-module (→ `restructure-research.md`). Voice works; the
shipped pieces (memory, knowledge, schedules, Telegram, the local marketplace, desktop-control, and
the global→workspace session routing) are proven. Near-term build: unify **"everything is a session"**
into one Session library, then the genuinely net-new surfaces — the **CLI**, the **cloud marketplace
backend**, and **memory backup/restore**. The one open call is the desktop shell (**Tauri vs
Electron**).

## 10. The one-sentence pitch

**Vynel is the desktop app that takes a non-technical person from *"I want to use AI"* to *"I'm
running my work on AI"* — without ever opening a terminal — by wrapping Claude Code's full power in a
control surface they can see, understand, and trust.**
