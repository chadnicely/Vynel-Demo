# Approvals — Overview

> The consent gate for agentic tool use — when the agent wants to do something irreversible, the turn pauses, a request is recorded, and it surfaces as a notification the user can answer from any screen before anything is written, sent, or deleted.
>
> **Status:** shipped (backend + HTTP surfaces + web notifier live end-to-end; channel push and routed-task surface-up are planned) · **Depends on:** [providers](../providers/overview.md), [chat](../chat/overview.md), [workspaces](../workspaces/overview.md), [users](../core/overview.md) · **Code map:** [structure.md](./structure.md)

## Purpose

Approvals is the trust layer that makes agentic tool use safe for non-technical people. Every time the agent reaches for an irreversible action — writing a file, editing one, running a shell command, sending an email, changing a calendar, writing to memory — the provider pauses the turn and waits for a verdict. This module intercepts that pause: it records the pending request as durable audit data, checks whether a saved rule already answers it, and otherwise parks it in a queue for the human to decide.

The module faces two audiences at once. To the agent, it is a synchronous gate: the paused tool call resumes (approved, with optionally-edited input) or aborts (denied, with a reason) the moment a decision lands. To the user, it is a visible, browsable record: a global notification queue that spans every session and workspace, plus an audit trail of past decisions and a set of auto-approve rules they can save and remove.

The defining design choice in this repo is **notification, not inline card**. A pending approval is not bound to the one chat stream that raised it. It is a user-scoped queue reachable from whatever screen is open — so a decision the user makes minutes later, from anywhere, still unblocks the parked agent. This is what lets background work (the assistant's own workspace-less "brain", and — once wired — channels and routed tasks) ask for approval without a live watcher.

## What it can do

- **Record an approval request** the instant the agent requests an irreversible tool use, capturing the tool, its input, the derived action kind, and the originating session as durable audit data.
- **Auto-approve** a request that matches a saved rule for its workspace — the agent is unblocked immediately and the user sees a resolved record rather than a prompt.
- **Surface a pending request in a global queue** the user can answer from any screen, spanning every session and workspace including the workspace-less assistant "brain".
- **Approve or deny** a pending request, unblocking the paused agent in real time; a denial carries a reason the agent can act on.
- **Edit the tool input before approving** — the corrected input is handed back to the agent so it acts on the fixed version (the data path ships; a field-picker UI is a later phase).
- **Remember a decision as a rule** — "always allow this action kind" or "always allow this exact tool" in this workspace — so future matching requests skip the prompt.
- **Browse recent approvals** as a cursor-paginated audit view, and **list or remove saved rules** from the workspace settings surface.
- **Recover stale pending requests** *(background)* — a recovery worker reaps requests nobody answered within the safety window, unblocking the parked agent with a timed-out denial and closing the audit row.
- **Purge expired data** *(background)* — resolved requests are hard-deleted after their retention window; soft-deleted rules are purged after theirs.

## Responsibilities

**Owns** — the two persistent stores (an append-only request/audit log and a soft-deletable set of user rules); the full request lifecycle from pending to resolved; the closed action-kind taxonomy and the pure derivation from a tool name to a kind; the rule-matching engine; the "remember this decision as a rule" logic; the global-queue read that gathers every pending request for a user; the workspace-scoped audit and rules reads; the stale-request recovery worker and the two retention-purge workers; and all five lifecycle outbox events that announce changes to the rest of the system.

**Does not own** —
- the agent runtime and the paused tool-call promise it unblocks — that is [providers](../providers/overview.md); this module calls into the provider to resolve a request, never the reverse, and resolves the provider by id so it stays provider-agnostic;
- the session that raises the request — that is [chat](../chat/overview.md), whose stream consumer records the request as a side effect of processing a turn, and whose own outbox consumer mirrors each decision back onto its tool-call records;
- the shared outbox machinery the events ride on — that belongs to the [db](../_platform/database/overview.md) kernel; this module only appends events, never consumes them;
- the visual approval card component — that is shared [ui](../_platform/primitives/overview.md); the web notifier composes it;
- pushing an approval to an origin channel like Telegram, and turning a routed/delegated task's request into a park-and-notify — those are future consumers ([channels](../channels/overview.md), [orchestration](../orchestration/overview.md)); this module already persists and resolves such requests, but the producer side that fans them out is not yet wired here.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **Approval request** | One paused tool use recorded as an append-only audit row. Never soft-deleted; retained on a time window, then hard-purged. |
| **Provider approval id** | The identifier the provider supplies when it pauses a tool call. The hot-path lookup key, uniquely indexed. Distinct from the module's own row identifier. |
| **Action kind** | A closed nine-value taxonomy derived from the tool name at record time: email-send, file-write, file-edit, file-delete, calendar-write, shell-command, external-action, memory-write, and a catch-all "other". Stored verbatim, never re-derived on read. |
| **Decision** | The verdict on a request: approved (optionally with edited input and/or a rule to remember) or denied (with a required reason). A third outcome, timed-out, is system-generated by the recovery worker; a cancelled outcome is reserved. |
| **Auto-approve** | A request resolved immediately by a matching rule, before the user is ever prompted; the agent is unblocked synchronously. |
| **Approval rule** | A user-saved auto-approve preference in a workspace: match by action kind, or by exact tool name. Soft-deleted with a retention window. A variant matching on specific argument values is deferred to a later phase. |
| **Global approval queue** | The user-scoped view of every pending request across all sessions, all workspaces, and the workspace-less brain — the "answer from any screen" surface. |
| **The brain (workspace-less card)** | A request from the assistant's own top-level scope, which has no workspace. It persists (its workspace reference is empty) and always parks as pending, since no workspace rule can match it. |
| **Stale-pending recovery** | The background reap of pending requests older than the safety window, resolving them as timed-out — surviving process restarts, where the in-memory paused promise dies but the audit row remains. |

## Rules & invariants

- **The provider call comes before the row update when resolving.** If unblocking the agent fails, the row stays pending and the recovery worker eventually times it out. The inverse order would risk an audit row marked resolved while the agent waits forever — a strictly worse failure.
- **Every state change co-commits its outbox event in one transaction.** The row write and the matching lifecycle event land together or not at all.
- **Action kind is derived once, at record time, and stored.** The stored value is ground truth; the derivation table can evolve without invalidating old rows.
- **The request log is never soft-deleted.** It is a pure audit trail governed by time-based retention; only the rules store soft-deletes.
- **Resolution is scoped by user, not workspace.** A request is uniquely found by its provider approval id and guarded on user ownership alone, so it can be answered from any surface — including a brain card that names no workspace. A wrong-owner request returns the same "not found" as a truly missing one, leaking no existence.
- **The auto-approve fast path preserves the ordering invariant.** The audit row is written first; the provider is unblocked outside any transaction; only then does the resolve-and-announce transaction run.
- **A workspace-less brain card always parks.** With no workspace, no workspace-scoped rule can match, so rule evaluation is skipped and the request waits for a human.
- **The agent must never self-approve.** The decide and rule-mutation routes are not exposed to the agent's tool surface; only safe reads are.
- **A stale request is only reaped after a doubled timeout window.** Staleness is measured generously so the worker never fires on a request the user might still be actively deciding.

## Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: agent requests an irreversible tool use → request recorded
    Pending --> RuleCheck: workspace rule evaluated
    state "Rule match?" as RuleCheck
    RuleCheck --> AutoApproved: matched → provider unblocked immediately
    RuleCheck --> Queued: no match (or brain card → always queued)

    Queued --> Approved: user approves (optionally edits input / saves a rule)
    Queued --> Denied: user denies with a reason
    Queued --> TimedOut: recovery worker reaps a stale request

    AutoApproved --> [*]: audit row resolved; a "resolved by your rule" pill shows
    Approved --> [*]: provider unblocked; outbox mirrors the decision to chat
    Denied --> [*]: provider receives the denial; the agent adjusts or reports
    TimedOut --> [*]: agent unblocked with a timeout denial; audit row closed
```

## Where it sits in the bigger picture

Approvals is the safety gate that sits between the [providers](../providers/overview.md) runtime and the user. When the agent asks to use an irreversible tool, the provider pauses the turn and holds the paused call in memory. [Chat](../chat/overview.md)'s stream consumer records the request through this module and learns instantly whether it was auto-approved (emit a status pill) or left pending. When the user decides, this module calls back into the provider to resume or abort the paused call, then announces the outcome; chat's outbox consumer mirrors that decision onto its own tool-call records so the conversation view stays truthful.

The user answers from a global notification queue rather than an inline card: the web surface polls the user-scoped pending list and slides any waiting request in as a decidable notification, no matter which view is open. This is the mechanism that makes background approvals reachable — the workspace-less brain's requests persist and queue today, and the planned consumers ([channels](../channels/overview.md) pushing a card to Telegram, [orchestration](../orchestration/overview.md) parking a routed task on the user's approval instead of auto-denying it) build directly on the same persisted request and the same resolve path, which already work end-to-end at the backend.

---
*Mapped from the code on disk, 2026-07-14. If you change this module, update this file and [structure.md](./structure.md).*
