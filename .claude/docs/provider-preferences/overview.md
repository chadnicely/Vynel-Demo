# Provider Preferences — Overview

> Which AI provider a user has chosen to run by default — the one editable preference behind "who answers when you talk to Vynel," with a safe fallback when the user has never picked.
>
> **Status:** shipped (landed green, no wired consumers yet) · **Depends on:** [db](../_platform/database/overview.md) (kernel), [providers](../providers/overview.md) · **Code map:** [structure.md](./structure.md)

## Purpose

Vynel can front more than one AI provider. This module answers one narrow question: *which provider should we run for this user?* It's the management logic over a single stored choice — the user's default provider — plus the rule that decides what to run when they've never chosen.

It's plumbing, not a product surface. There's no panel here, no user-visible verbs of its own — a settings screen elsewhere will call in to read and flip the choice. What makes it a distinct module rather than a loose helper is a deliberate **concern split**: it was carved out of a former grab-bag so that *preference* (which provider you like) lives apart from *provider status* (is that provider installed and authenticated) and *skills discovery* (what a provider can do). This package holds preference and nothing else.

The one idea worth internalizing is the **effective default**. A user who has never chosen still needs a provider to run, so every "which provider" question funnels through one function that returns their explicit choice or falls back to Claude. That "Claude is the default" rule lives in exactly one line, so a future change of default — or a Phase-2 different default — is a one-line swap, not a scattered `?? 'claude'` across every caller.

## What it can do

- **Read the user's chosen default** — the raw read, which is honest about "unset" by returning nothing when the user has never picked.
- **Read the user's effective default** — the same thing but never blank: the explicit choice, or Claude when there is none. This is what callers that just need "who do we run" use.
- **Set the user's default provider** — point them at a provider, atomically, preserving the "exactly one default per user" invariant. A first-time choice can carry initial opaque settings; a re-pointing to an already-known provider updates that row rather than making a duplicate.

There is no operation to *change* a preference's settings after the row exists, and no delete — those are deliberate absences, covered under Rules.

## Responsibilities

**Owns** — the default-provider *logic* and its guarantees: the null-returning raw read, the never-null effective read with its "Claude is the default" fallback, and the atomic set that flips the default flag across a user's rows so exactly one stays true. It owns the invariant, not the storage.

**Does not own** —
- the `provider_preferences` table itself, its columns, indices, and repository reads/writes — those live in the **kernel** ([db](../_platform/database/overview.md)), because the row foreign-keys to the users hub and so its schema and repos must stay down there;
- the set of valid provider ids and the default-provider constant — borrowed from the provider seam ([providers](../providers/overview.md));
- whether a provider is actually **installed or authenticated** — a separate *provider-status* concern, not yet pulled;
- what each provider **can do** (skills) — a separate *skills discovery* concern, not yet pulled;
- actually *running* the chosen provider — the runtime seam ([providers](../providers/overview.md)), a neighbour this module never reaches into.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **Preference** | One stored (user, provider) pairing — the user likes this provider, optionally with opaque settings. A user may have several such rows but only one marked default. |
| **Default provider** | The single preference marked as the user's default. The "exactly one per user" invariant is the module's core guarantee. |
| **Effective default** | The answer to "who do we run": the user's explicit default, or Claude when they have none. Never blank. |
| **Provider id** | Which AI provider — `claude` · `codex` · `gemini` · `cursor`. Validated at the application layer, borrowed from the provider seam. |
| **Default settings** | An opaque per-provider settings blob attached to a preference — e.g. the user's default permission mode. Written only when a preference is first created; never queried inside. |
| **Unset** | A user with no preference row. Reads distinguish this (raw read returns nothing) from "chose Claude explicitly," while the effective read collapses both to Claude. |

## Rules & invariants

- **Exactly one default per user.** Setting a default is one atomic transaction: clear every default flag for that user, then set the chosen one. The invariant is enforced by this operation, not by a database partial index — SQLite and Postgres disagree on partial-index support, so the guarantee is kept in code.
- **Claude is the effective default, in one place.** A user with no preference resolves to Claude. That fallback is centralized in the effective-read function alone; no caller carries its own fallback.
- **Setting is an upsert, never a duplicate.** Re-pointing a user at a provider they've chosen before updates the existing row rather than inserting a second one — so a user has at most one row per provider.
- **Initial settings are seed-only.** A preference's opaque settings can be supplied when the row is first created; on a later re-selection they're ignored. There is no operation here to edit settings after creation.
- **No delete.** Preferences are user-edited config; "delete" would mean revert to provider defaults, which a missing row already expresses — so there's no soft-delete, no retention, no purge.
- **Every row carries the user.** The preference is user-scoped throughout (this module is not workspace-aware), keeping it multi-user-ready for Phase 2 without rework.
- **No cross-feature signal.** Setting a default publishes no outbox event in Phase 1 — the events surface is a documented empty placeholder, kept so it has a home if a signal is ever needed.

## Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Unset: user has never chosen (effective = Claude)
    Unset --> Default: set default provider
    Default --> Default: re-point to another provider (atomic flip, upsert)
```

## Where it sits in the bigger picture

Provider preferences is a small leaf that answers one question for the rest of Vynel: *which provider do we run for this user?* It reads its data from the kernel ([db](../_platform/database/overview.md), which owns the table because it links to users) and borrows the set of valid providers and the default constant from the provider seam ([providers](../providers/overview.md)) — the same neighbour that actually runs a provider once the choice is known. A settings surface in [local-api](../_apps/local-api/overview.md) / [local-web](../_apps/local-web/overview.md) is the natural place to expose reading and flipping the default, and any turn that needs to pick a provider is a natural caller of the effective read; those wirings are the next step rather than something in place today. Its two deliberately-excluded siblings — provider *status* and *skills discovery* — will land as their own concerns, keeping this leaf about preference alone.

> **Note on intent vs. code:** this module is sometimes described as storing "which provider *and model* a *user or workspace* prefers." The code on disk stores neither a model nor a workspace scope — it is provider-only and user-only. This overview follows the code.

---
*Mapped from the code on disk, 2026-07-14. If you change this module, update this file and [structure.md](./structure.md).*
