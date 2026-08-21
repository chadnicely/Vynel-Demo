// Where the daemon comes from — resolved ONCE before supervision starts.
//
// Bundled (installed app): the payload sits beside the exe (gold layout, G1) —
//   <install>\resources\engine\vynel-engine.exe   pinned runtime (renamed node)
//   <install>\resources\engine\dist\...           compiled server bundle + node_modules
//   <install>\resources\ui\                       built local-web dist
// with all mutable state under the app data home (survives upgrades):
//   <app_data>\data\vynel.db · models\ · config.env (user overrides)
//
// Repo (dev, D1): walk up from the exe (or VYNEL_DESKTOP_REPO_ROOT) to a
// checkout and run the tsx entry — unchanged from the pre-installer flow.

use std::path::{Path, PathBuf};

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

#[derive(Clone)]
pub struct BundledLaunch {
    /// resources\engine — the daemon's cwd; vynel-engine.exe and
    /// dist\server.mjs inside it.
    pub engine_dir: PathBuf,
    /// resources\ui — served by the gateway (sidecar mode).
    pub web_dir: PathBuf,
    /// The app data home — DB, models, user config.env live here.
    pub app_data_dir: PathBuf,
    /// The installed version (tauri.conf.json), stamped into the daemon env.
    pub app_version: String,
}

pub fn resolve_launch_plan(handle: &tauri::AppHandle) -> Option<LaunchPlan> {
    let exe = std::env::current_exe().ok()?;
    let install_dir = exe.parent()?.to_path_buf();
    let engine_dir = install_dir.join("resources").join("engine");

    if engine_dir.join("dist").join("server.mjs").exists() {
        let app_data_dir = match crate::data_home::resolve_data_home(handle) {
            Ok(dir) => dir,
            Err(error) => {
                log::error!("bundled payload found but no data home ({error}) — cannot launch the daemon");
                return None;
            }
        };
        let bundled = BundledLaunch {
            web_dir: install_dir.join("resources").join("ui"),
            engine_dir,
            app_data_dir,
            app_version: handle.package_info().version.to_string(),
        };
        // The engine-location choice (written by the settings flow, read
        // pre-daemon by design — the local-first + restart contract).
        // engine_config.rs owns the file format.
        if let Some(install_id) = crate::engine_config::read_remote_install_id(&bundled.app_data_dir) {
            return Some(LaunchPlan::Remote(RemoteLaunch { bundled, install_id }));
        }
        return Some(LaunchPlan::Bundled(bundled));
    }

    resolve_repo_root().map(LaunchPlan::Repo)
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
