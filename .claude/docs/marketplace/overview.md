# Marketplace — Overview

> Vynel's browse-and-install surface over the curated catalog: the shelf where a user finds a skill or an agent and adds it to their global brain or to one workspace.
>
> **Status:** shipped · **Depends on:** [db](../_platform/database/overview.md) (kernel — now hosts its catalog-cache table), [contracts](../_platform/contracts-and-sdk/overview.md) · **Code map:** [structure.md](./structure.md)

## Purpose

The marketplace is what turns Vynel from a fixed assistant into an extensible one: a store the user browses to discover published capabilities and install them with one action. It answers a small set of questions — *what can I add? is it already installed here? where would it live?* — and hands the actual adding-to-disk off to the leaf that owns each kind.

What makes it a product surface rather than plumbing is the **shelf**. The user opens the marketplace on the global surface (the whole-account store) or inside a workspace (that room's store), sees each published item with its publisher badge and an install state, and adds or removes it. The module's whole job is to present an honest, correctly-scoped shelf: it shows only the items a surface is allowed to list, marks exactly the ones already installed *for that caller*, and never advertises a Get button for a kind it can't yet install.

The catalog it presents is a **merge of two sources** — a small bundled catalog that ships in the code, unioned with a locally-cached copy of the cloud catalog that a background job keeps in sync with the hub. Because that cache lives on disk, the shelf resolves synchronously and works offline. Today only two item kinds — **skill** and **agent** — ever reach the shelf; three more kinds exist in the cloud registry but are deliberately filtered out until each has a real install target (see *Rules*).

## What it can do

- **Browse a surface's items** — resolve the merged catalog, keep only what the requested surface lists, annotate each with the caller's install state, then filter (by category, publisher tier, installed / not-installed, free-text search) and sort (recommended, name, newest).
- **Look up one item on a surface** — the same shape as browse for a single id, used as the gate before an install or uninstall.
- **Report install state per item** — every item is annotated *installed* or *not-installed* for this exact caller and surface, matched per kind (a skill by its catalog id, an agent by its slug and community provenance), preferring a workspace-scope match over a user-scope one when both exist.
- **Answer "which surface lists this?"** — the pure rule that decides whether an item belongs on the global shelf, a workspace shelf, or both.
- *(background)* **Apply a cloud-catalog sync** — replace the whole local cache with a freshly-fetched hub catalog (a full swap, since the curated catalog is small), and clear the cache entirely on sign-out or when the hub goes away.

## Responsibilities

**Owns** — the shelf's *presentation and gating*, and nothing that writes an installed artifact. It owns the catalog merge (bundled ∪ cloud, deduped by id with cloud winning); the surface-visibility rule that both read paths share so browse and lookup can never disagree; the per-kind install-status annotation; the in-memory filter/sort pipeline; the local cloud-catalog cache table (in the shared kernel) and the logic that applies a sync or clears it; the surface gate that makes off-surface, hidden, and unknown ids all fail identically; and the injection seam through which it reads a caller's installed rows without importing the leaves that own them. It publishes **no** outbox events.

**Does not own** —
- the actual install — extracting a verified artifact and writing the skill or agent to disk and its row — that lives in [skills](../skills/overview.md) and [agents](../agents/overview.md), one install function per kind;
- the install / uninstall **orchestration** and the composition of those leaves — the [local-api](../_apps/local-api/overview.md) app hosts the routes that call the surface gate, download the artifact, and dispatch to the right leaf's install function;
- the truth of *which* skills and agents a caller has installed — those rows are owned by [skills](../skills/overview.md) and [agents](../agents/overview.md); the marketplace only reads a structural view of them through injected readers the app binds;
- fetching the cloud catalog and downloading artifacts from the hub — the [hub-account](../hub-account/overview.md) session and the app's sync job; the marketplace only *applies* the result;
- the wider item-kind registry (mcp, rule, plugin) — those are hub-side concepts; the desktop union is only the kinds it can install.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **Catalog item** | One published, installable thing on the shelf — a display name, one-line description, publisher, category, icon, version, and an install state. |
| **Item kind** | What the item *is*: `skill` or `agent`. The cloud registry knows more kinds; only these two reach the desktop shelf. |
| **Surface** | Where a browse/install request comes from: the `global` store (user-scope installs) or one `workspace`'s store. |
| **Surfacing scope** | Which surface(s) list an item: `user` (global only), `workspace` (that room only), or `both`. Distinct from the two scopes below. |
| **Recommended scope** | The install picker's *default* scope for an item — a suggestion, not where it must go. |
| **Install-status scope** | Where an *already-installed* row actually lives (`user` or `workspace`) — a fact about the caller, not the catalog. |
| **Bundled catalog** | The small set of items that ships in the code — what the cloud catalog stood in for before it existed. |
| **Cloud catalog cache** | A local, on-disk copy of the hub's catalog, refreshed by a background sync; lets the shelf resolve synchronously and offline. |
| **Publisher tier** | The badge on an item: `verified`, `anthropic-official`, or `community`. |
| **Minimum tier** | Cloud items only: the access tier (`basic` / `pro`) needed to install — shown as a badge; the real gate is server-side at download. |
| **Install status** | Per-caller annotation on every item: `not-installed`, or `installed` with its scope, the installed row's id, and (skills only) the installed version. |

## Rules & invariants

- **A surface only shows — and only installs — what it's allowed to list.** Global lists user + both; a workspace lists workspace + both. The one visibility rule drives browse *and* lookup, so the shelf and the install gate can never disagree.
- **Off-surface, hidden, and unknown are one answer.** Asking for an item that doesn't exist, that's hidden, or that belongs to the other surface all fail the same way — the shelf never leaks that an id it won't serve exists.
- **Cloud wins on merge.** When the same id ships bundled *and* arrives from the cloud, the cloud copy replaces the bundled one, deduped by id — so a duplicate can never create install-status ambiguity.
- **Only installable kinds surface.** Cloud items that aren't `skill` or `agent` are filtered at the merge — honest UI over dead Get buttons — until each deferred kind (mcp, rule, plugin) has a real install target.
- **Install state is per caller and per kind.** A skill matches by its catalog id; an agent matches by slug *and* community provenance — a hand-made agent whose slug collides with a catalog id never flips to "Installed" (and so is never removed by an uninstall).
- **Workspace beats user on a tie.** When a caller has the same item installed at both scopes, the annotation reports the workspace-scope one.
- **The shelf resolves synchronously.** The catalog and its filter/sort run in memory off the on-disk cache; only artifact download and disk writes (elsewhere) are async.
- **It owns a cache table but emits no events.** The module now owns the local cloud-catalog cache in the shared kernel — a deliberate supersede of its original "owns no tables" premise (a stale comment in the code still states the old premise) — and it publishes no outbox events at all.
- **Sync is a full swap.** Applying a fresh hub catalog replaces the entire cache, so a stale row can never survive; sign-out clears it outright.

## Where it sits in the bigger picture

The marketplace is a thin, pure presentation leaf that sits *above* the capability leaves it advertises but never imports them. It reads a caller's installed skills and agents through an injection seam that the [local-api](../_apps/local-api/overview.md) app fills with the real readers from [skills](../skills/overview.md) and [agents](../agents/overview.md) — the leaf-decoupling recipe that keeps sibling leaves from importing each other. When a user clicks Get, it's that same app route, not this leaf, that runs the surface gate here, downloads the verified artifact through the [hub-account](../hub-account/overview.md) session, and dispatches into the owning leaf's install function. A background sync job feeds this module its cloud-catalog cache; the desktop shelf in [local-web](../_apps/local-web/overview.md) renders what browse returns. The marketplace is the storefront; the skills and agents leaves are the warehouse that actually stocks the shelf.

---
*Mapped from the code on disk, 2026-07-14. If you change this module, update this file and [structure.md](./structure.md).*
