// Where the daemon comes from — resolved ONCE before supervision starts.
//
// Bundled (installed app): the payload sits beside the exe —
//   <install>\node.exe                    pinned runtime (tauri externalBin)
//   <install>\resources\backend\dist\...  compiled server bundle + node_modules
//   <install>\resources\web\              built local-web dist
// with all mutable state under Tauri's app_data_dir (survives upgrades):
//   <app_data>\data\vynel.db · models\ · config.env (user overrides)
//
// Repo (dev, D1): walk up from the exe (or VYNEL_DESKTOP_REPO_ROOT) to a
// checkout and run the tsx entry — unchanged from the pre-installer flow.

use std::path::{Path, PathBuf};
use tauri::Manager;

pub enum LaunchPlan {
    Bundled(BundledLaunch),
    /// Remote mode (Phase D3): the engine runs on the user's server; the
    /// shell spawns the bundled TUNNEL entry instead of the daemon. Same
    /// supervision, same port — nothing downstream changes.
    Remote(RemoteLaunch),
    Repo(PathBuf),
}

pub struct RemoteLaunch {
    /// The same bundled payload — the tunnel entry lives beside server.mjs.
    pub bundled: BundledLaunch,
    /// Which install row the tunnel targets; None = newest healthy install.
    pub install_id: Option<String>,
}

pub struct BundledLaunch {
    /// The install dir (exe-adjacent) — holds node.exe.
    pub install_dir: PathBuf,
    /// resources\backend — the daemon's cwd; dist\server.mjs inside it.
    pub backend_dir: PathBuf,
    /// resources\web — served by the gateway (sidecar mode).
    pub web_dir: PathBuf,
    /// Tauri app_data_dir — DB, models, user config.env live here.
    pub app_data_dir: PathBuf,
    /// The installed version (tauri.conf.json), stamped into the daemon env.
    pub app_version: String,
}

pub fn resolve_launch_plan(handle: &tauri::AppHandle) -> Option<LaunchPlan> {
    let exe = std::env::current_exe().ok()?;
    let install_dir = exe.parent()?.to_path_buf();
    let backend_dir = install_dir.join("resources").join("backend");

    if backend_dir.join("dist").join("server.mjs").exists() {
        let Ok(app_data_dir) = handle.path().app_data_dir() else {
            log::error!("bundled payload found but no app_data_dir — cannot launch the daemon");
            return None;
        };
        let bundled = BundledLaunch {
            web_dir: install_dir.join("resources").join("web"),
            install_dir,
            backend_dir,
            app_data_dir,
            app_version: handle.package_info().version.to_string(),
        };
        // The engine-location choice (written by the D4 settings flow, read
        // pre-daemon by design — the local-first + restart contract).
        if let Some(install_id) = read_remote_engine_config(&bundled.app_data_dir) {
            return Some(LaunchPlan::Remote(RemoteLaunch { bundled, install_id }));
        }
        return Some(LaunchPlan::Bundled(bundled));
    }

    resolve_repo_root().map(LaunchPlan::Repo)
}

/// Reads <app_data>\engine.json — `{ "mode": "remote", "installId": "..." }`.
/// Returns Some(install_id) when remote mode is configured; absent file,
/// local mode, or a malformed file (logged) all mean local.
fn read_remote_engine_config(app_data_dir: &Path) -> Option<Option<String>> {
    let config_path = app_data_dir.join("engine.json");
    let raw = std::fs::read_to_string(&config_path).ok()?;
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            log::warn!("engine.json is malformed ({error}) — staying in local mode");
            return None;
        }
    };
    if parsed.get("mode").and_then(|mode| mode.as_str()) != Some("remote") {
        return None;
    }
    Some(
        parsed
            .get("installId")
            .and_then(|id| id.as_str())
            .map(|id| id.to_string()),
    )
}

/// The repo root: env override first, else walk up from the exe until a dir
/// contains apps/local-api/src/server.ts (robust to the cargo target layout).
fn resolve_repo_root() -> Option<PathBuf> {
    if let Ok(overridden) = std::env::var("VYNEL_DESKTOP_REPO_ROOT") {
        let root = PathBuf::from(overridden);
        if daemon_entry_exists(&root) {
            return Some(root);
        }
        log::warn!("VYNEL_DESKTOP_REPO_ROOT does not contain apps/local-api — ignoring it");
    }
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent();
    while let Some(candidate) = dir {
        if daemon_entry_exists(candidate) {
            return Some(candidate.to_path_buf());
        }
        dir = candidate.parent();
    }
    None
}

fn daemon_entry_exists(root: &Path) -> bool {
    root.join("apps")
        .join("local-api")
        .join("src")
        .join("server.ts")
        .exists()
}
