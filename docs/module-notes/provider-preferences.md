# provider-preferences — `@vynel/provider-preferences`

**Status: ✅ LANDED GREEN (2026-07-03).** The seam's first consumer — the user's default-provider
preference over the kernel `provider_preferences` table.

## The concern split (why this is preferences-ONLY)
The old repo's `core/src/providers/` was a **grab-bag of three concerns**. We split it by real concern
(Chad: "preference is not skills") — this package is **preferences only**:

| concern | ops | landed / home |
|---|---|---|
| **preferences** (the `provider_preferences` table) | `findDefaultProviderForUser`, `getDefaultProviderForUser`, `setDefaultProviderForUser` | ✅ **`@vynel/provider-preferences`** (this) |
| **skills discovery** | `discoverInstalledSkillsForProvider` | ⏳ the **skills** domain (with `core/src/skills`, later) |
| **provider status** | `getProviderAuthenticationStatus`, `listProvidersWithStatus`, `ProviderRuntimeNotInstalledError` | ⏳ a **provider-status** concern (with the routes, later) |

**When those two pulls happen, their ops come from the OLD repo's `core/src/providers/` — don't re-home
them here.** The old files stay untouched until then.

## Shape
- Package deps `@vynel/db` + `@vynel/providers` (NOT the pure seam's — this is the DB-touching consumer).
  Reads the kernel `provider_preferences` repo (hub table FKs to users → schema+repos stay in kernel).
- `find*` returns null (raw read); `get*` never returns null — falls back to `DEFAULT_PROVIDER_ID`
  ('claude'), the "claude is the default" rule centralized in one line (mirrors `@vynel/workspaces`
  find/get). `set*` = atomic default-flip transaction.
- Flat `src/*.ts` (small package, mirrors `@vynel/workspaces`). Continues decomposing `@vynel/core`.
