// No desktop-owned tables. `desktop_app_grants` was dropped with the per-app
// grant model (2026-08-13) — the turn's approved plan is the only authority,
// and it lives for the turn, not in the database.
export {}
