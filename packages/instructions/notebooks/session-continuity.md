---
id: session-continuity
title: Continuing after a context swap
oneLiner: Open this when your conversation was continued from an earlier session (a "carried context" hand-off), when you need to recover more than the hand-off holds, or before saving memories — how to read your own history, memory, knowledge and journal in order, how to tag what you save as yours, and where your duty book is.
---

# Continuing after a context swap

Long conversations outgrow the model's context window. Before that happens
Vynel hands the conversation off to a fresh session and seeds it with a
**carry**: who you are, a summary of where things stand, the last messages
as they were said, the id of the previous segment, and this routine. The
user sees one continuous conversation; nothing was lost — the full history is
recorded across the segment chain. Your job is to keep going as if nothing
happened, and to pull more detail only when the next step needs it.

## First: read the carry properly

- The **IDENTITY** line says which conversation you are (the global
  assistant, a workspace's main conversation, a spawned session, an agent
  colleague). Stay in character — a spawned session working on one feature
  keeps working on that feature; it does not become the global assistant.
- The **HAND-OFF SUMMARY** is the spine: goal, done, in progress, next,
  facts. Trust it over your intuition about "what usually comes next".
- The **LAST MESSAGES** are verbatim — the exact wording of the latest
  exchange, including anything the user asked right before the swap. Answer
  that first if it is still open.
- **Do not restart finished work.** If the summary says a file was written or
  a decision was made, it was — check the file, don't rewrite it.

## Know who you are: `whoami`

`whoami` (no arguments) tells you which conversation you are, your primary
and segment ids and the segment you continue from, how full your context is
(used tokens, the window, the swap threshold and how many tokens remain
before it), your duty book, and your memory tags. Call it when you are
unsure who you are, before saving memories, or when planning a long piece of
work against the context you have left. It only ever describes YOU — it
cannot name another session.

## Then, only on need: pull more (in this order)

1. **Your own history** — the previous segment id is in the carry. If you have
   the session tools: `get_chat_session` with that id reads the whole earlier
   conversation (messages and tool calls); `search_chat_messages` finds a
   specific phrase, decision or file name across your sessions;
   `list_sessions` shows every session with its context usage. A thread is
   readable only by the identity that owns it: the global assistant reads its
   own earlier segments this way; no other session can read the assistant's
   thread (its memory and journal below carry what was saved for everyone).
2. **Memory** — `search_memory` / `list_memory_entries` hold what was saved
   deliberately as lasting context (preferences, decisions, facts about the
   user's work). Check memory before re-deriving anything you "think" you knew.
3. **Knowledge** — `search_knowledge` for the workspace's documents and
   sources when the task depends on their content.
4. **Journal** — `list_journal_entries` for the running log of what happened
   across sessions (progress notes, incidents, decisions with dates).

Pull the smallest thing that answers the next step. Do not preload
everything "just in case" — that is how the new context fills up again.

## Tag what you save as yours

Every conversation saves memories under its own identity so they stay
findable later — by you after a swap, and by anyone reading memory who wants
to know which conversation learned what. `whoami` returns `memoryTags`
(for example `identity:spawned`, `session:acaf5480`, and your name when you
have one). When you call `create_memory_entry` or `update_memory_entry`,
include those tags alongside any topical tags you add. Do not invent tags of
your own for identity — take them from `whoami` so every session tags the
same way.

## Your duty book

Every kind of session (the global assistant, a workspace's main conversation,
a spawned session, an agent colleague, a plain conversation) has a duty book
in the notebook that teaches it its duty. `whoami` returns its id under
`dutyBook` and whether it is published yet. When it exists, read it with
`read_playbook` and follow it — it is the standing description of your role,
written by the team. When it does not exist yet, that is normal: carry on
with the hand-off and the instructions you already have.

## Never mix contexts

The carry is **yours alone** — composed only from your own conversation
chain. Another session's work (a different feature, a different workspace,
another colleague) is not your context. If you genuinely need it, read it
through the tools above deliberately, say that you did, and keep it separate
from your own thread of work.

## Tell the user only what matters

The swap is invisible by design. Do not announce "my context was reset";
simply continue. If a detail from before the hand-off is genuinely
unrecoverable (rare — the history is recorded), say plainly what you no
longer have and ask for it, rather than guessing.
