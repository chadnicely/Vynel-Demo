// Where the engine runs — the ONE piece of state the shell must read BEFORE
// any daemon exists (launch_plan.rs), so it cannot live in the DB the daemon
// owns. `<app_data>\engine.json`:
//
//   { "mode": "local" }
//   { "mode": "remote", "installId": "<server_installs.id>" }
//
// The UI reads/writes it through these commands and asks the user to restart
// (the locked local-first + restart contract — Chad, 2026-07-28). Absent file
// = local, so a fresh install needs nothing.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const ENGINE_CONFIG_FILE: &str = "engine.json";

#[derive(Serialize, Deserialize, Clone)]
pub struct EngineConfig {
    /// "local" | "remote" — a string (not an enum) so an unknown future value
    /// degrades to local instead of failing the read.
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_id: Option<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::data_home::resolve_data_home(app).map(|dir| dir.join(ENGINE_CONFIG_FILE))
}

/// The pre-daemon read (launch_plan.rs): Some(install_id option) in remote
/// mode, None for local — absent file, local mode, or an unreadable/malformed
/// file (logged) all mean local, so a broken config never blocks launch.
pub fn read_remote_install_id(app_data_dir: &std::path::Path) -> Option<Option<String>> {
    let path = app_data_dir.join(ENGINE_CONFIG_FILE);
    let raw = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            log::warn!("engine.json is unreadable ({error}) — staying in local mode");
            return None;
        }
    };
    let config: EngineConfig = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(error) => {
            log::warn!("engine.json is malformed ({error}) — staying in local mode");
            return None;
        }
    };
    if config.mode != "remote" {
        return None;
    }
    Some(config.install_id)
}

#[tauri::command]
pub fn engine_get_config(app: tauri::AppHandle) -> Result<EngineConfig, String> {
    let path = config_path(&app)?;
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Ok(EngineConfig {
            mode: String::from("local"),
            install_id: None,
        });
    };
    serde_json::from_str(&raw).map_err(|error| format!("engine.json is unreadable: {error}"))
}

#[tauri::command]
pub fn engine_set_config(
    app: tauri::AppHandle,
    mode: String,
    install_id: Option<String>,
) -> Result<(), String> {
    if mode != "local" && mode != "remote" {
        return Err(format!("unknown engine mode \"{mode}\""));
    }
    if mode == "remote" && install_id.is_none() {
        return Err(String::from("remote mode needs the install id to connect to"));
    }
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("cannot create {parent:?}: {error}"))?;
    }
    let config = EngineConfig {
        mode: mode.clone(),
        install_id: install_id.clone(),
    };
    let body = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("cannot serialize engine.json: {error}"))?;
    // Temp-then-rename: a torn write here would leave the shell unable to
    // decide where the engine runs on the very next launch.
    let staging = path.with_extension("json.tmp");
    std::fs::write(&staging, body).map_err(|error| format!("cannot write engine.json: {error}"))?;
    std::fs::rename(&staging, &path).map_err(|error| format!("cannot replace engine.json: {error}"))?;
    log::info!("engine mode set to {mode} (install {install_id:?}) — applies on restart");
    Ok(())
}

/// Restart the app so `resolve_launch_plan` re-reads engine.json and spawns
/// the other mode's child (the updater's restart muscle).
#[tauri::command]
pub fn engine_restart_app(app: tauri::AppHandle) {
    log::info!("restarting to apply the engine mode change");
    app.restart();
}
