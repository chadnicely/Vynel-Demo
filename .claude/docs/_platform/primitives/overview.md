# Platform Primitives — Overview

> The four leaf packages the whole monolith stands on: a shared error vocabulary, a logging contract, the test-database seam, and the design-system components. They own no domain and depend on almost nothing — everyone imports *down* into them.
>
> **Status:** shipped · logger is contract-only (partial) · **Depends on:** nothing above them; the test seam alone leans on [db](../../db/overview.md) (kernel) · **Code map:** [structure.md](./structure.md)

## Purpose

These are the primitives — the smallest, most-depended-on packages in the repo. Every feature package (`@vynel/memory`, `@vynel/chat`, `@vynel/approvals`, …) and every app imports one or more of them, and none of them imports a feature back. They exist so that four cross-cutting concerns have exactly **one home** instead of being re-invented per module: how errors are shaped, how logs are emitted, how tests get a real database, and how the UI looks.

They are **plumbing, not product surfaces** — with one deliberate exception. The design-system package ships the **approval card**, which the operating contract calls the product's *trust primitive*: the visible "the assistant wants to do X — allow or deny?" card that appears on every irreversible action. That single component is a product surface living inside a plumbing package because it is shared verbatim across every UI surface.

Three of the four are genuinely tiny by line count — the error taxonomy, the logger contract, and the test helper are each a handful of exports. Their weight is in how universally they are imported, not in how much code they contain. The design-system package is the substantial one: a full component library plus the visual token contract.

## What it can do

- **Throw a typed, HTTP-shaped error.** Any domain raises one of a small set of error classes; each carries the HTTP status and machine code it should become at the boundary. A single check at the API edge turns any of them into the right response — the class *is* the response shape.
- **Distinguish "not found" from "you may not see this."** Separate error types exist for missing, conflicting, invalid, unauthenticated, forbidden, and rate-limited — the vocabulary the whole system uses to fail precisely.
- **Accept a logger without owning one.** Core operations and shared code take a three-level structural-logger *shape* (info / warn / error); apps supply the real implementation at their boundary. No `console.log`, and no logging runtime reaches the core layer.
- **Give every test a real database.** A single helper hands a test a fresh, migrated SQLite file in a temp directory, runs the callback, then closes and deletes it — so tests exercise real SQL and *never* mock the database.
- **Render the shared UI.** A component set for the conversational surfaces: the approval card, markdown and code rendering, message rows, tool-call cards, the chat composer, presence and voice indicators, segmented tabs, empty states, and the Claude identity mark.
- **Present a raw tool call as something a human reads.** Pure presenter functions turn a raw tool-call row (its name, input, and output) into a verb, an argument, and a typed body (code / diff / terminal / text / payloads) — "Wrote pricing.md +12", not a JSON dump.
- **Give each workspace a stable color and monogram.** Deterministic helpers hash a workspace name to one accent slot and a short monogram, so the same workspace reads as itself on every surface with no stored column.
- **Carry the one visual contract.** A token stylesheet defines every surface color, ink level, hairline, radius, font, and motion curve — dark by default, light as an override — with a hard rule reserving gold for assistant presence.

## Responsibilities

**Owns** — the cross-cutting *shapes and shared assets* the rest of the codebase agrees on: the error base class and its generic subclasses (with their HTTP status and code), the structural-logger type, the real-database test seam and its migration wiring, and the shared Vue component library plus its design tokens, tool-call presenters, and workspace color/monogram helpers.

**Does not own** —
- **any business logic or domain data** — the feature packages own that; a primitive never reaches up into a feature;
- **the error-to-HTTP switch itself** — the primitives define the error classes, but the [local-api](../../_apps/local-api/overview.md) app owns the single error-to-HTTP boundary that reads them;
- **the concrete logger** (pino wiring, levels, transports) — instantiated at each app's boundary, injected in as the structural shape; the primitive publishes only the contract today;
- **the database, schema, and migrations** — the [db](../../db/overview.md) kernel; the test seam only *drives* db's migrations, it doesn't define them;
- **screens, routing, and state** — the [local-web](../../_apps/local-web/overview.md) app assembles the shared components into an actual product; the primitive ships the parts, not the app;
- **the meaning of a tool call or an action's risk** — the presenters and the approval card *render* what [chat](../../chat/overview.md) and [approvals](../../approvals/overview.md) decide.

## The four primitives

| Primitive | What it is | Substance |
|---|---|---|
| **Errors** | One abstract error base + a small set of generic HTTP-semantic subclasses (not-found, conflict, validation, unauthorized, forbidden, rate-limited). A dependency-free leaf so both the core and provider layers can throw the same taxonomy without forming an import cycle. | Small but load-bearing — imported by nearly every package. |
| **Logger** | A three-method structural-logger *type* (info / warn / error) that core code accepts and apps implement. The pino dependency is declared for the eventual shared factory, but only the contract ships today. | Tiny — a single published type; implementation deferred to the app boundary. |
| **Testing** | The test-database seam: a fresh migrated SQLite file per call under the OS temp dir, torn down after. The one sanctioned way for cross-package tests to touch a real database. | Small but pivotal — it enforces the "never mock the DB" gate. |
| **UI** | The shared design system: ~17 Vue components (approval card, markdown, code block, message row, tool-call cards, composer, voice orb, …), the token stylesheet, tool-call presenters, and workspace color/monogram helpers. | The substantial one — a real component library. |

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **Error taxonomy** | One abstract base and a *small generic* set of subclasses. Per-domain "not found" wrappers are forbidden — every domain throws the shared subclasses directly. |
| **Status + code** | Every error class carries an HTTP status and a machine code. The API boundary reads them off the class; the class is the wire response shape. |
| **Structural logger** | The minimal logging shape core code depends on — three levels (info / warn / error), each taking a structured payload and an optional message. Pino satisfies it in apps; tests pass a no-op or in-memory buffer. |
| **The test seam** | The single helper that yields a real, migrated, throwaway database. "Never mock the DB" is a project gate; this is how it's kept. |
| **Design tokens** | CSS custom properties for color, ink, hairlines, radius, type, and motion — the one visual contract every UI surface reads. Dark default, light override. |
| **Gold = presence** | The signature rule: gold means the assistant is alive there — running, streaming, or awaiting approval. Nothing else may use it. |
| **Claude mark** | The assistant's coral identity spark. Identity only — presence stays gold. |
| **Approval card** | The product's trust primitive: a data-blind card (props in, approve/deny out) shown inline in a thread and as a compact shell notification. Danger actions (file-delete, shell, email-send) read visually distinct. |
| **Tool-call presenter** | Pure functions turning a raw tool-call row into a verb + argument + typed body; unknown tools fall back to generic payload panes. |
| **Workspace accent / monogram** | A per-workspace color and short monogram derived by hashing the workspace *name* — stable across surfaces, no stored column, off-limits to gold. |

## Rules & invariants

- **A primitive never imports upward.** These are leaves: features and apps depend on them; they depend on nothing in a feature. The error package is deliberately dependency-free so it can sit under both core and providers without a cycle.
- **The error class is the response shape.** Status and code live on the class; a *single* boundary check maps any subclass to HTTP. There is no per-domain error zoo — the generic set is thrown directly.
- **No logging runtime in the core layer.** Core code accepts only the logger *shape*; the concrete implementation is injected at the app boundary. `console.log` is banned in production code.
- **Tests use a real database, always.** The seam gives every cross-package test a genuine SQLite file and migrations, then deletes it. Mocking the database is never allowed. (The db kernel keeps its *own* local copy of this helper to avoid a db↔testing workspace cycle.)
- **Gold is reserved for assistant presence.** Design tokens enforce it: workspace accents, file-type colors, and status colors are all kept off amber/orange so gold reads unambiguously as "the assistant is active here."
- **The approval card works data-blind.** Everything it needs arrives via props and every decision leaves via events, so the same component renders inline in a thread and as a compact notification without knowing where it lives.
- **Workspace color follows the name, not the id.** The accent and monogram are hashed from the normalized workspace name so a bubbled-up report row and its in-flight banner resolve to the same color with no lookup. (The name is the *last* segment of a persona-first source label — if that label format changes, this helper must change with it.)

## Where it sits in the bigger picture

Primitives are the floor of the modular monolith — the layer everything else rests on and nothing rests below (only the [db](../../db/overview.md) kernel sits alongside them, and only the test seam reaches into it). The [core](../../core/overview.md) and [providers](../../providers/overview.md) layers and every feature package throw the shared errors and accept the shared logger. The [local-api](../../_apps/local-api/overview.md) app owns the one boundary that turns those errors into HTTP and injects the concrete logger. The [local-web](../../_apps/local-web/overview.md) app composes the shared UI components — the approval card fed by [approvals](../../approvals/overview.md), the tool-call cards and presenters fed by [chat](../../chat/overview.md) — into the actual product screens. And every test in the repo, in every package, reaches its database through the one test seam. Small packages, maximal reach.

---
*Mapped from the code on disk, 2026-07-14. If you change any of these packages, update this file and [structure.md](./structure.md).*
