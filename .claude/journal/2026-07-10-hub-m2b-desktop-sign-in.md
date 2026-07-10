# 2026-07-10 — Hub M2b: desktop sign-in (hub-account leaf · /hub surface · Account UI)

**The move.** Third milestone in one day: the desktop now signs in to the hub. New
`packages/hub-account` (typed hub client · keyring vault · serialized session state machine),
`contracts/hub` wire types shared by both sides, local-api `/hub` routes + adaptive boot-check
service, SDK `hub.*` namespace, and the Account UI section (subagent-built to sibling idiom).
Gate 2081/4-skip; reviewer: no must-fix, 5 should-fixes applied.

## Learnings worth keeping

- **The pairing test lives on the APP side.** `packages never import apps` also binds tests — the
  leaf↔real-hub integration test sits in apps/cloud-api (devDep on the leaf), while the leaf keeps
  stub-based unit tests. Both layers caught different things.
- **A stateful session service needs an op queue on day one.** Boot restore, daily re-check, and
  user sign-in/out all mutate the vault; the reviewer found interleavings that resurrect a cleared
  token or leak a device family. One `serialized()` promise-chain wrapper fixed every case.
- **"Offline" is a UX liveness promise, not just a state.** The UI said "will retry
  automatically" while the daemon's re-check was 24h away — the copy defined the requirement.
  Adaptive cadence (60s while offline, daily when settled) + UI refetch only-while-offline.
- **Typed network errors beat raw fetch errors at route boundaries.** Raw network throws became
  500 "Internal server error" on the sign-in form; a `HubUnreachableError` (503) gives routes an
  actionable message while restore() still reads it as offline (verdict = 401/403 only).
- **Terminal-state cards need an exit affordance** (locked → "Sign in again") — any state the
  daemon re-checks slowly must be escapable by the user.
- **Subagent UI delegation worked** because the brief pinned the sibling idioms (sections
  patterns, tokens-only, gold-is-presence) and demanded typecheck + suite runs; its report
  flagged a real repo tension (dialog gold buttons vs the rule) worth a future sweep.

## Deferred (reviewer-noted)

Offline-at-boot has null identity until M3 persists the entitlement snapshot · pre-boot-check
status flash · DeviceRow pending-disable + revoke-error surfacing · keyring `load()` conflates
no-entry with broken-keyring · 404 mapping drops the hub's message · real Windows Credential
Manager path awaits Chad's first live sign-in.
