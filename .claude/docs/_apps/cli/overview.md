# CLI — Overview

> The `vynel` command-line surface: a thin terminal client over the *same* generated, typed SDK the desktop web app uses, driving the running local-api daemon over HTTP so you can search, inspect, and safely manage a workspace from a shell or a script.
>
> **Status:** partial — real and tested, but a deliberately narrow, read-focused slice of the API (version `0.0.0`, private, unpublished, Phase-1 no-auth). **Depends on:** [sdk](../../sdk/overview.md), [local-api](../local-api/overview.md) (the daemon it calls) · **Code map:** [structure.md](./structure.md)

## Purpose

The CLI is one of Vynel's thin app surfaces. It carries no business logic of its own — it parses a command line, calls the matching method on the generated Vynel SDK client, and prints the typed result as JSON. Everything it can do, the SDK can do, and everything the SDK can do, the local-api daemon actually performs.

It exists for the people the desktop UI is *not* for: developers, power users, and scripts. The non-technical end user lives in the [local-web](../local-web/overview.md) desktop experience; the CLI is the same capabilities reached from a terminal, where output is machine-readable and commands compose into automation. Because it shares one generated SDK with the web app, the two surfaces can never drift apart — a route added to the API becomes a method on both at once.

What it is *not* is a second brain or a local worker. It holds no state, opens no database, and starts no session. It is a mouth and a pair of eyes on a daemon that must already be running.

## What it can do

Five command groups, each mapping onto one feature's slice of the API. The bias throughout is **reads plus the safe mutations** — anything that carries a credential or creates from scratch is intentionally left to the UI.

- **Knowledge** — search the index (keyword, semantic, or hybrid), list and fetch indexed documents, check indexer status, force a reindex, and register / list / remove the folders and files a workspace (or the user, globally) indexes and watches.
- **Skills** — list installed and available skills, install one at user or workspace scope, uninstall it, enable / disable it, and re-sync installed skills with what's on disk.
- **Channels** — list a workspace's connected messaging channels, list all of the user's channels across scopes, inspect one, view its allowed senders, and enable / disable / disconnect it. *Connecting* a channel (which carries a bot token) is deliberately absent.
- **Schedules** — list a workspace's scheduled tasks, list all of the user's across scopes, browse templates, read a schedule's run history, and enable / disable / delete / fire-one-now.
- **Marketplace** — browse and fetch marketplace items. Read-only.

Two cross-cutting conveniences: `--help` and `--version` work with no daemon running (the client is built lazily), and most every command is workspace-scoped through a required workspace flag, while the "mine" variants read across both the user's global and workspace scopes at once.

## Responsibilities

**Owns** — the command tree and its parsing, the mapping from each command's arguments and flags onto the correct namespaced SDK method, coercion and validation of flag values at the boundary, printing a successful result as pretty JSON to stdout, and translating any thrown error into a stderr message plus a non-zero exit code. It also owns the one place it reads its environment: the base URL of the daemon to call.

**Does not own** —
- the API endpoints, request handling, and any real work — the [local-api](../local-api/overview.md) daemon;
- the typed client, the generated types, and the namespaced facade it calls through — the [sdk](../../sdk/overview.md) package, regenerated from the API's OpenAPI snapshot;
- every feature's actual behavior (searching, installing, scheduling, disconnecting) — the feature packages behind the API, reached only over HTTP;
- authentication — Phase 1 has none, so neither does the CLI; it lands with the Phase-2 auth work.

## Concepts & vocabulary

| Term | Meaning |
|---|---|
| **Command group** | A top-level noun (`knowledge`, `skills`, `channels`, `schedules`, `marketplace`), each fronting one feature's SDK namespace. |
| **Subcommand** | A verb under a group (`search`, `install`, `disable`, `fire-now`), one per SDK method the surface exposes. |
| **Workspace flag** | The required scoping argument nearly every command takes — the room the command acts on. |
| **Scope** | `user` vs `workspace`. Some installs and reads distinguish the whole-user view from a single room; `mine` commands span both. |
| **The client** | A single typed SDK instance built lazily from the base-URL env; every command calls a method on it. |
| **Namespaced SDK** | The `client.knowledge.search(...)` style facade the CLI calls — the same one the web app uses, throwing on non-2xx. |
| **JSON output** | The CLI's only output format: the typed result, pretty-printed to stdout; errors go to stderr. |
| **Base-URL env** | The one environment value the CLI reads — where the daemon lives, defaulting to the local-api dev port. |

## Rules & invariants

- **Everything goes through the running daemon.** The CLI never touches a database, a feature package, or the AI runtime directly — it only makes HTTP calls to local-api. No daemon, no command (beyond help / version).
- **Calls dispatch through the daemon's `/api` mount, not its root.** That is the one external surface; routing there keeps the voice proxy from shadowing the API's own routes.
- **The client is built lazily.** `--help` and `--version` resolve without a server or the env, because the client is only constructed when a command actually needs to call out.
- **Environment is read in exactly one place.** The base URL is Zod-validated at that single gate and defaults to the local-api dev port — no scattered `process.env` reads.
- **The surface is read-first and mutation-shy.** It exposes reads plus only the *safe* lifecycle mutations; credential-carrying operations (connecting a channel) and from-scratch creation are left to the UI on purpose. The marketplace group is read-only.
- **Output is machine-readable.** Success is pretty-printed JSON on stdout; every failure becomes a stderr message and a non-zero exit code, so scripts can branch on it.
- **The program is testable without a process.** The command tree is built from an injected client factory, so tests drive it against a stub — no server, no spawned process, no real network.

## Where it sits in the bigger picture

The CLI is a leaf at the very edge of the system, one of the thin app surfaces that never get imported by anything else. It sits beside [local-web](../local-web/overview.md) as a peer consumer of the [sdk](../../sdk/overview.md): the web app injects the client into Vue composables, the CLI wraps the same client in commander subcommands, and both bottom out at the [local-api](../local-api/overview.md) daemon that holds the real logic. Where [mcp](../mcp/overview.md) exposes Vynel's features to the *assistant* as tools and [voice](../voice/overview.md) exposes them to speech, the CLI exposes them to a *shell* — the same capabilities, a different mouth. It is the developer's and the script's door into a workspace, and it stays honest by design: a narrow, tested slice today, widening only as the SDK it mirrors does.

---
*Mapped from the code on disk, 2026-07-14. If you change this module, update this file and [structure.md](./structure.md).*
