# 2026-07-03 — provider-preferences (the seam's first consumer)

The fast-follow to the provider seam: a new leaf-consumer package for the user's **default-provider
preference**, so the seam becomes usable. New package **`@vynel/provider-preferences`** (deps `@vynel/db`
+ `@vynel/providers`; devDep `@vynel/testing`) — hub-consumer logic over the kernel `provider_preferences`
table (schema + repos already in the kernel; the table FKs to the users hub, so they stay there).

**Split the old grab-bag by concern (Chad: "preference is not skills").** The old `core/src/providers/`
mixed three concerns; I first mis-scoped it as one "preferences" package. Corrected — pulled **preferences
only**:
- `findDefaultProviderForUser(db, userId)` → the explicit choice or `null` (raw read).
- `setDefaultProviderForUser(db, input)` → atomic default-flip in one transaction (upsert; "exactly one
  default per user").
- preference type re-exports + an empty events placeholder + barrel.

**Left behind for their own domains** (deliberately NOT pulled): `discoverInstalledSkillsForProvider` →
the **skills** domain; `getProviderAuthenticationStatus` / `listProvidersWithStatus` /
`ProviderRuntimeNotInstalledError` → a **provider-status** concern. They ride in with skills / the routes
later, landing in the right place instead of being pre-mixed here.

**The fold — Claude as the default (Chad: "also set claude default").** Added `getDefaultProviderForUser`,
the non-null sibling of `find` (mirrors the `@vynel/workspaces` find/get pair): returns
`findDefaultProviderForUser(…) ?? DEFAULT_PROVIDER_ID` — i.e. `'claude'` when the user hasn't chosen. This
centralizes the "claude is the default" rule (and the Phase-2 swap point) in one line, instead of every
consumer remembering a `?? 'claude'` fallback. Ships its own test (fallback + explicit-choice).

Cleaned the dead `docs/blueprints/providers/blueprint.md §…` citations from the pulled comments (those
docs aren't in KLONE); made `randomUUID` an explicit `node:crypto` import (was a bare global).

**Gate green:** typecheck (18 pkgs) + parity (schema 30 · mcp 7 · sdk 7/8, unchanged) + vitest **677 pass /
4 skip** (this package = 2 files / 7 tests). Continues decomposing `@vynel/core` (now `users` + `_shared`;
after `users`, core disappears).
