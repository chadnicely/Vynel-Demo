// The user-facing data home: %APPDATA%\Vynel — a friendly folder like
// "Telegram Desktop" (Chad, 2026-08-09), decoupled from the Tauri identifier
// that keys app_data_dir. The identifier (app.vynel.desktop) stays untouched:
// it anchors updater and single-instance continuity, and only this module
// knows the folder moved. Everything mutable lives here — data\vynel.db,
// models\, logs\ (daemon + shell), config.env, engine.json.
//
// The one-shot migration MUST run before the log plugin is registered: its
// Folder target eagerly creates %APPDATA%\Vynel\logs at plugin init, and a
// migration that only ran later would see "both dirs exist" on the very first
// updated boot and strand the user's data in the legacy folder forever (the
// reviewer-caught G1b hole). main() calls migrate_legacy_data_home() as its
// first statement.

use std::path::{Path, PathBuf};
use tauri::Manager;

const DATA_HOME_DIR_NAME: &str = "Vynel";
// Mirrors `identifier` in tauri.conf.json — the pre-0.2.0 app_data_dir name.
const LEGACY_IDENTIFIER_DIR_NAME: &str = "app.vynel.desktop";

/// The entries that constitute user data. `logs\` is deliberately absent:
/// the new home may already carry a logs dir (the log plugin creates it
/// eagerly), and legacy diagnostics are not worth a merge.
const MIGRATED_ENTRIES: [&str; 4] = ["data", "models", "config.env", "engine.json"];

pub fn data_home_from_env() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|roaming| PathBuf::from(roaming).join(DATA_HOME_DIR_NAME))
}

/// The pre-plugin migration entry point (env-based — no AppHandle exists
/// yet). Log output here is best-effort: the logger attaches later, so the
/// idempotent re-run inside resolve_data_home is what leaves the durable
/// trace.
pub fn migrate_legacy_data_home() {
    if let Some(roaming) = std::env::var_os("APPDATA") {
        migrate_within(Path::new(&roaming));
    }
}

/// Resolve the data home for daemon/config use. The migration already ran in
/// main(), but re-running is a cheap no-op and covers non-APPDATA resolution
/// paths. Falls back to the legacy dir only while the user's data is STILL
/// there (a failed rename — e.g. an old daemon holding files); once `data\`
/// lives in the new home, the home is authoritative forever.
pub fn resolve_data_home(handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let legacy = handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("no app data dir: {error}"))?;
    let Some(roaming) = legacy.parent() else {
        return Ok(legacy);
    };
    migrate_within(roaming);
    let home = roaming.join(DATA_HOME_DIR_NAME);
    if legacy.join("data").exists() && !home.join("data").exists() {
        log::warn!(
            "user data is still in {} (migration could not move it) — using the legacy home this launch",
            legacy.display()
        );
        return Ok(legacy);
    }
    Ok(home)
}

/// Idempotent: whole-dir rename when the new home doesn't exist yet, else a
/// per-entry move when the home exists but carries no user data (only the
/// eagerly-created logs dir). A home that already holds `data\` — a genuine
/// downgrade round trip — stays authoritative and the legacy dir is ignored.
fn migrate_within(roaming: &Path) {
    let legacy = roaming.join(LEGACY_IDENTIFIER_DIR_NAME);
    let home = roaming.join(DATA_HOME_DIR_NAME);
    if !legacy.exists() {
        return;
    }
    if !home.exists() {
        match std::fs::rename(&legacy, &home) {
            Ok(()) => log::info!(
                "data home migrated: {} → {}",
                legacy.display(),
                home.display()
            ),
            Err(error) => log::warn!(
                "data home migration failed ({error}) — data stays in {} for now",
                legacy.display()
            ),
        }
        return;
    }
    if home.join("data").exists() || !legacy.join("data").exists() {
        return;
    }
    for entry in MIGRATED_ENTRIES {
        let from = legacy.join(entry);
        if !from.exists() {
            continue;
        }
        let to = home.join(entry);
        if to.exists() {
            continue;
        }
        if let Err(error) = std::fs::rename(&from, &to) {
            log::warn!("data home migration: could not move {entry} ({error})");
        }
    }
    log::info!(
        "data home migrated entry-by-entry into the pre-created {}",
        home.display()
    );
}
