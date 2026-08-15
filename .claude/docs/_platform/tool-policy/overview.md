# Tool Policy — Overview

> One governance layer answering, for every tool Claude can call: does it exist in this build,
> on which kinds of turns, behind which plan tier and capability, and when does it need the
> user's approval — with the operator, the shipped release, and the user each holding a layer
> of that answer.
>
> **Status:** shipped · **Depends on:** [capabilities](../../capabilities/overview.md) ·
> [contracts-and-sdk](../contracts-and-sdk/overview.md) · [registry](../../registry/overview.md) ·
> **Code map:** [structure.md](./structure.md)

## Purpose

Vynel gives an AI agent real tools — reading memory, running SSH commands, driving the
desktop, deleting agents. Which of those tools a given turn may even *see*, and which calls
must pause on an approval card, used to be decided by plumbing scattered across descriptors,
hand-picked composition lists, and the AI SDK's permission quirks. Tool policy makes that one
legible system: a **declared catalog** of every tool with sensible defaults, refined by three
layers of intent — what the **operator** ships, what the **user** customizes, and what the
**code** declares — resolved the same way on every kind of turn.

It is a product surface twice over: the desktop app's *Tool access* panel is the user's half
of Vynel's trust promise (you can always see and tighten what Claude may touch), and the cloud
admin portal's *Tool policy* page is the operator's control room for what each release ships.

## What it can do

- **Show the user every tool Claude has** — grouped by feature, with where it's available,
  when it cards, and which plan tier or capability it rides — and let them edit all of it.
- **Let the operator author the shipped defaults** in the cloud portal: turn tools off, move
  them between surfaces, promote or demote approval carding, re-tier or un-gate them —
  globally, for every install of the next release.
- **Make out-of-plan tools invisible, not broken** — a basic-tier install never shows the
  agent a pro tool, instead of advertising it and failing the call.
- **Card exactly the right calls** — a curated destructive tier asks in Ask mode; anything
  promoted to "always" cards in every mode that can card; everything else resolves instantly
  from the map instead of nagging.
- **Bake the operator's map into each desktop release** *(background)* — the release build
  downloads the current map and ships it inside the app; a policy change distributes with the
  next version, never by a runtime fetch.
- **Keep every consumer in lockstep automatically** *(background)* — a new tool added to the
  product joins the SDK, both MCP servers, the catalog, and the admin matrix through one
  regeneration step, guarded by parity checks in the test gate.

## Responsibilities

**Owns** the tool catalog and its snapshot, the vocabulary of surfaces and card classes, the
per-user override store and its resolver, the operator-defaults store on the hub with its
versioned map export, the baked-map layer in the engine, and the two editing surfaces (the
app's Tool access panel, the portal's Tool policy page).

Does not own:

- **The approval card runtime** — parking a call, the decide UI, Telegram approvals, the
  reaper — that is [approvals](../../approvals/overview.md); tool policy only decides *which*
  calls enter it.
- **The per-workspace capability toggles** (memory / knowledge / notebook on-off switches) —
  those belong to [capabilities](../../capabilities/overview.md); tool policy reads them as
  one of its gates and hosts their first UI beside its own panel.
- **Entitlements and tiers themselves** — the hub's account system
  ([hub-account](../../hub-account/overview.md)) mints the signed tier proof; tool policy only
  consumes the resulting feature-key set.
- **Tool generation and the MCP servers** — the [mcp app shell](../../_apps/mcp/overview.md)
  emits and hosts the tools; tool policy governs them.
- **Permission modes** (ask / auto / bypass…) — the session domain owns the mode; tool policy
  supplies the mode × card-class decision table the provider consults.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **Catalog** | The declared roster: every tool the product composes, with its default surfaces, card class, and gates. Derived from code, never hand-listed. |
| **Catalog snapshot** | A generated, committed copy of the catalog that surfaces without engine access (the hub, the portal) read; parity-guarded against drift. |
| **Surface (consumer kind)** | The kind of turn a tool may attach to — interactive chat, channel turns, schedule fires, delegated runs, spawned sessions, agent sessions. Nine kinds. |
| **Card class** | When a tool's calls pause on an approval card: `never` (resolve instantly), `ask` (card in the asking modes), `always` (card in every mode that can card). |
| **Tier gate** | A hub feature key a tool requires; missing it makes the tool invisible for that install. `'none'` in an override means "un-gate". |
| **Capability gate** | A workspace capability a tool rides; toggled off, the tool is denied for that workspace. |
| **User override** | One user's per-tool customization, every field nullable — null inherits the layer below; an all-null save *is* the reset. |
| **Operator map** | The hub-stored global defaults the operator edits in the portal — same nullable-inherit shape, no user scoping. |
| **Baked map** | The operator map as shipped: downloaded at release-build time, carried inside the app, loaded once at boot. |
| **Effective policy** | The per-tool answer a turn actually uses: code catalog ⊕ baked map ⊕ user override. |
| **The regeneration point** | The one generate step that keeps the SDK, the MCP servers, the catalog snapshot, and therefore the whole policy world in lockstep with the routes. |

## Rules & invariants

- **The catalog is the roster.** A policy row naming a tool the build doesn't declare is inert
  — never resurrected, never composed; a stale row can always be deleted.
- **Three layers, and the user wins.** Code declares, the baked map re-defaults, the user's
  own override has the last word. Null always means "inherit the layer below".
- **Out-of-tier means invisible.** Gating happens at composition — the model never sees a tool
  the install isn't entitled to, so it cannot call-and-fail its way into confusion.
- **Every call reaches the decision.** No wildcard pre-approvals anywhere; the permission
  callback consults the map for each tool call, and the curated destructive tier plus anything
  promoted to `always` enters the card flow.
- **An agent never edits its own gates.** The policy-editing routes are deliberately not
  exposed as tools, on either the product or the hub.
- **Changes ship with versions.** The baked map is downloaded at build time only — there is no
  runtime policy fetch; retuning shipped apps means shipping a release.
- **Fail in the right direction.** No entitlement yet → fail open (dev keeps working). Build
  configured for a hub it can't reach → fail the build loudly. Shipped map mangled → warn and
  fall back to code defaults, because a user's engine must never brick on a bad bake.

## Where it sits in the bigger picture

Tool policy is platform, not a feature chapter: it sits between the
[mcp shell](../../_apps/mcp/overview.md) that manufactures tools and the
[providers seam](../../providers/overview.md) that executes turns, deciding per turn what the
model sees and what must card into [approvals](../../approvals/overview.md). Its vocabulary
and snapshot live in shared [contracts](../contracts-and-sdk/overview.md) so the
[hub](../../registry/overview.md) and its admin portal can speak it without touching the
engine; its per-user store rides the [capabilities](../../capabilities/overview.md) leaf; and
the release pipeline carries its baked map into every installed copy of the app.

---
*Mapped from the code on disk, 2026-08-14. If you change this module, update this file and [structure.md](./structure.md).*
