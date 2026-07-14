# MCP — Overview

> The seam that turns Vynel's HTTP capabilities into tools the assistant can call — one route definition surfacing both as an in-process tool for the live session and as a standalone server for outside MCP clients.
>
> **Status:** partial · **Depends on:** [db](../../_platform/database/overview.md) (kernel), [mcp-contract](../../_platform/contracts-and-sdk/overview.md), [sdk](../../_platform/contracts-and-sdk/overview.md) · **Code map:** [structure.md](./structure.md)

## Purpose

Vynel defines each capability once, as an HTTP route. The MCP app is what lets that same capability be *called by the assistant* — it takes the routes marked for exposure and presents them to the model as callable tools, without anyone hand-writing a second copy of the logic. A tool call is just an in-process HTTP request back into the api; the route stays the single home of the behaviour.

Two audiences consume those tools, and this app serves both from the same annotated routes:

- **The live session** — when a conversation turn runs, the assistant is handed an in-process tool server built from the route registry. This is the everyday path: memory writes, knowledge searches, and the rest happen through it.
- **Outside MCP clients** — a generic stdio server that any MCP host (a different agent, an external tool) can launch. It reads Vynel's published API description and dispatches each tool call over HTTP to the running daemon.

It is plumbing more than a product surface, but two of its rules are felt directly by the user: a **capability toggle** switches whole groups of tools on or off, and a **mutating tool** raises an approval card before it acts.

## What it can do

- **Expose a route as a tool** — any route carrying the MCP annotation (an exposed flag, a tool name, a description) becomes a tool automatically; nothing is hand-wired per surface.
- **Serve the live session** — build a per-turn, in-process tool server whose handlers carry that session's credentials, so every tool acts as the right user in the right workspace.
- **Serve outside clients over stdio** — run as a standalone server that reads the published API description and relays each call to the daemon over HTTP.
- **Gate tools by capability** — deny a capability's whole tool group when the user has that capability switched off, so a disabled feature exposes none of its tools.
- **Flag mutating tools for approval** — declare the irreversible tools so the session composer makes them raise an approval card even under a permissive mode.
- **Switch toolset by turn type** — hand a workspace turn the full working registry, and a global-root ("manager") turn only its delegation tools, so the brain can see and route to workspaces without reaching into them.
- *(background)* **Stay in lock-step with the routes** — the in-process registry is generated from the API description, and a parity guard fails the build if the two ever drift.

## Responsibilities

**Owns** — the translation from annotated routes to callable MCP tools, for both consumers. It owns the in-process tool server built for each session turn (workspace registry and global-root routing registry, both under the one `vynel` server name), the per-session scope those handlers close over, the mapping of which tool belongs to which capability, the declaration of which tools are mutating, and the generic stdio server that relays outside clients' calls to the api. It is also the sanctioned home, alongside the session runtime's MCP layer, for the SDK's tool-*builder* primitives.

**Does not own** —

- the routes and their business logic — each feature owns its own ([memory](../../memory/overview.md), [knowledge](../../knowledge/overview.md), and the rest), and the [local-api](../local-api/overview.md) app hosts them;
- the code generator and parity guards that emit the registry from the API description — the shared generator scripts;
- the published API description and typed client it reads — [sdk](../../_platform/contracts-and-sdk/overview.md);
- the descriptor *contract* every tool surface implements, and the composition that attaches descriptors to a turn, applies the capability gate, and unions the mutating tools into the approval backstop — [mcp-contract](../../_platform/contracts-and-sdk/overview.md) defines the shape; the [local-api](../local-api/overview.md) composer runs it;
- the AI *runtime* that actually invokes the tools — quarantined in [providers](../../providers/overview.md); only the runtime-free tool-builder primitives live here;
- the desktop tools — a separate, core-free descriptor ([desktop-control](../../desktop-control/overview.md)) plugs into the same composition.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **MCP** | Model Context Protocol — the standard by which an assistant discovers and calls tools. Vynel speaks it on both sides: it exposes tools, and its tools reach back into the api. |
| **`x-mcp` annotation** | The marking on a route that opts it into tool exposure: an *exposed* flag, the tool's *name*, its *description*, and whether a mutating route is *approved* for exposure. |
| **In-process tool server** | The tool set built fresh for a live session turn, running inside the daemon. Its handlers dispatch to routes as in-process HTTP calls — never straight into feature logic. |
| **External (stdio) server** | A standalone, generic server for outside MCP clients. Reads the published API description and relays each call to the running daemon over real HTTP. |
| **`vynel` server** | The single server name both live registries share; every tool it exposes is addressed as `mcp__vynel__<tool>`. Workspace and global-root turns fill it with different tools but never at the same time. |
| **Scope** | The per-session credentials (user, and workspace when there is one) baked into each tool handler when the turn's server is built — so a tool always acts as the right identity. |
| **Capability gate** | The map of which tool belongs to which capability. When a capability is off, its tools are denied wholesale. |
| **Mutating tool** | A tool whose effect is irreversible enough to warrant an approval card. Declared once so it cards automatically. |
| **Routing (manager) tools** | The global-root turn's only tools: see workspaces and delegate down. A root manages; it never reads a workspace's memory or files itself. |

## Rules & invariants

- **One definition, two consumers.** A capability is written once as a route; the in-process tool and the external tool are both *derived* from its annotation. No tool logic is hand-duplicated, and no tool bypasses its route to call feature logic directly.
- **A tool call is an HTTP call inward.** Every handler dispatches back into the api rather than reaching into a feature — the in-process equivalent of "wrap the API, never call the core."
- **The generated registry cannot drift.** It is emitted from the API description and defended by a parity guard; a route and its tool can never silently disagree.
- **Handlers are built per turn, never at module load.** Each session's server bakes that session's scope into its handlers, so credentials are never shared or raced across sessions.
- **A capability off means none of its tools.** Memory and knowledge tools each gate together with their capability; the always-available groups (skills, channels, schedules) stay ungated.
- **Mutating tools card automatically.** A tool declared mutating is unioned into the approval backstop and raises a card even under a bypass mode — the declaration is additive and never removes the runtime's native floor.
- **Roots are managers, not doers.** A global-root turn is given only routing tools; it delegates into workspaces rather than acting inside them. The two registries share the `vynel` name but never coexist in one turn.
- **The SDK runtime stays out.** Only the SDK's runtime-free tool-*builder* primitives are permitted here; the SDK runtime that executes a turn lives solely in the providers package.

## Where it sits in the bigger picture

MCP is the bridge between Vynel's routes and the model that drives a conversation. Every feature — [memory](../../memory/overview.md), [knowledge](../../knowledge/overview.md), and the others — defines routes; this app turns the annotated ones into tools. On a live turn, the [local-api](../local-api/overview.md) composer pulls this app's descriptors, applies the capability gate, folds the mutating tools into the approval backstop, and hands the assembled tool server to the [providers](../../providers/overview.md) runtime, which is the only place allowed to actually run the model. The descriptor *shape* both this app and [desktop-control](../../desktop-control/overview.md) implement comes from [mcp-contract](../../_platform/contracts-and-sdk/overview.md); the API description the tools are generated from and the stdio server reads comes from [sdk](../../_platform/contracts-and-sdk/overview.md). The external stdio server is the one surface facing *outward* — the same tools, offered to any MCP client, dispatched over HTTP to the daemon. The status is *partial* because the everyday workspace surface and the external server are live and tested while the global-root routing surface is wired but still empty, awaiting its routing routes.

---
*Mapped from the code on disk, 2026-07-14. If you change this module, update this file and [structure.md](./structure.md).*
