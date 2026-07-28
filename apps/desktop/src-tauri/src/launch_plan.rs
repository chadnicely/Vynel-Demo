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
    Repo(PathBuf),
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
        return Some(LaunchPlan::Bundled(BundledLaunch {
            web_dir: install_dir.join("resources").join("web"),
            install_dir,
            backend_dir,
            app_data_dir,
            app_version: handle.package_info().version.to_string(),
        }));
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
