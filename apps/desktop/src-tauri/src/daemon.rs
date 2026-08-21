// The local-api daemon sidecar (release builds only). Two launch modes,
// resolved once by launch_plan.rs: BUNDLED (installed app — the pinned
// vynel-engine.exe (renamed node) runs the compiled dist/server.mjs from
// resources\engine, state in app_data) and REPO (dev checkout —
// `node --import tsx`, unchanged D1 flow).
// The port probe doubles as the health check — the daemon binds its port as
// the LAST step of a successful boot (migrations + services first, see
// local-api boot.ts) and advertises it in ~/.vynel/engine.port. The port is
// ALLOCATED per boot (canonical first, never assumed) — an end-user machine
// may have any port taken.
//
// If another process already serves the port (e.g. `pnpm dev`), we attach to
// it instead of spawning. A bundled launch also brings up the voice daemon
// (voice_sidecar.rs) once the engine answers. Supervision + shutdown
// semantics live in sidecar.rs. Shell diagnostics go through the log plugin:
// stdout when a terminal is attached, and the platform log dir always.

use crate::engine_port::{
    choose_engine_port, choose_voice_port, discover_running_engine, port_is_listening,
    CANONICAL_ENGINE_PORT,
};
use crate::launch_plan::{resolve_launch_plan, BundledLaunch, LaunchPlan};
use crate::sidecar::{self, SidecarState};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

static DAEMON: Mutex<SidecarState> = Mutex::new(SidecarState::new());

/// Release-mode entry: make sure a daemon serves the port, then open the
/// windows on the main thread. Runs off-thread so setup() returns immediately
/// (a frozen event loop would never paint the windows).
pub fn ensure_daemon_then_open_windows(handle: tauri::AppHandle, dock_only: bool) {
    // Resolved here (not in the supervisor thread) — the plan needs the
    // AppHandle for app_data_dir + the packaged version.
    let plan = resolve_launch_plan(&handle);
    std::thread::spawn(move || {
        // The voice daemon rides a BUNDLED launch only: an engine we attach
        // to (pnpm dev) belongs to a checkout with its own voice arrangement,
        // and a remote engine's gateway cannot reach a daemon on this machine.
        let voice_launch = match &plan {
            Some(LaunchPlan::Bundled(bundled)) => Some(bundled.clone()),
            _ => None,
        };
        let (expected_port, voice_port) = match discover_running_engine() {
            // A live engine already advertises a port (pnpm dev, a previous
            // shell, a shifted worktree band) — attach, never rival it.
            Some(port) => {
                log::info!("attaching to the engine already listening on 127.0.0.1:{port}");
                (port, None)
            }
            None => {
                // Repo mode: the checkout's .env owns PORT — spawn portless
                // and discover where the engine lands via its port file.
                // Bundled/remote: the shell allocates and passes PORT down.
                let spawn_port = match &plan {
                    Some(LaunchPlan::Repo(_)) | None => None,
                    Some(_) => Some(choose_engine_port()),
                };
                // Allocated BEFORE the engine spawns — the engine reads
                // VYNEL_VOICE_DAEMON_URL at boot and never again.
                let voice_port = match (&voice_launch, spawn_port) {
                    (Some(_), Some(engine_port)) => Some(choose_voice_port(engine_port)),
                    _ => None,
                };
                supervise_daemon(plan, spawn_port, voice_port);
                (spawn_port.unwrap_or(CANONICAL_ENGINE_PORT), voice_port)
            }
        };
        let engine_port = match wait_for_engine(expected_port, STARTUP_TIMEOUT) {
            Some(port) => port,
            None => {
                log::error!(
                    "no engine listening on 127.0.0.1:{expected_port} after {STARTUP_TIMEOUT:?} — opening the window anyway (it will show a connection error)"
                );
                expected_port
            }
        };
        // Started even when the engine is still booting past the timeout (a
        // first boot behind Defender's scan of the fresh payload): the engine
        // supervisor keeps it coming, and the voice daemon's engine relay
        // reconnects with backoff. Only an abandoned engine has no voice.
        if let (Some(bundled), Some(voice_port)) = (voice_launch, voice_port) {
            if sidecar::lock(&DAEMON).abandoned {
                log::warn!("engine abandoned — the voice daemon stays down with it");
            } else {
                crate::voice_sidecar::start(bundled, engine_port, voice_port);
            }
        }
        crate::windows::set_engine_port(engine_port);
        let handle_for_windows = handle.clone();
        let created = handle.run_on_main_thread(move || {
            if let Err(error) = crate::windows::create_windows(&handle_for_windows, dock_only) {
                log::error!("failed to create windows: {error}");
            }
        });
        if let Err(error) = created {
            log::error!("failed to reach the main thread for window creation: {error}");
        }
    });
}

/// Kill both sidecars on app exit — the voice daemon first (it talks to the
/// engine). Safe to call when nothing was spawned.
pub fn stop() {
    crate::voice_sidecar::stop();
    sidecar::stop(&DAEMON);
}

fn supervise_daemon(plan: Option<LaunchPlan>, spawn_port: Option<u16>, voice_port: Option<u16>) {
    std::thread::spawn(move || {
        let Some(plan) = plan else {
            log::error!(
                "no bundled payload beside the exe and no repo root found — set VYNEL_DESKTOP_REPO_ROOT or run the daemon yourself (`pnpm dev`)"
            );
            sidecar::lock(&DAEMON).abandoned = true;
            return;
        };
        sidecar::supervise(&DAEMON, "daemon", "daemon.log", |attempt| {
            // Re-choose on retries: the first pick may have lost the
            // probe-then-bind race — respawning onto the same taken port
            // would burn every remaining attempt. The port file reports the
            // final landing spot either way (wait_for_engine reads it first).
            let attempt_port = if attempt == 1 {
                spawn_port
            } else {
                spawn_port.map(|_| choose_engine_port())
            };
            spawn_daemon(&plan, attempt_port, voice_port)
        });
    });
}

fn spawn_daemon(
    plan: &LaunchPlan,
    spawn_port: Option<u16>,
    voice_port: Option<u16>,
) -> std::io::Result<Child> {
    let mut command = match plan {
        LaunchPlan::Bundled(bundled) => bundled_daemon_command(bundled, "dist/server.mjs")?,
        // Remote mode: the tunnel child supervises identically — same port,
        // same env layering; only the entry differs.
        LaunchPlan::Remote(remote) => {
            let mut command = bundled_daemon_command(&remote.bundled, "dist/tunnel.mjs")?;
            if let Some(install_id) = &remote.install_id {
                command.env("VYNEL_REMOTE_INSTALL_ID", install_id);
            }
            command
        }
        LaunchPlan::Repo(repo_root) => {
            let mut command = Command::new("node");
            command
                .arg(format!("--env-file-if-exists={}", repo_root.join(".env").display()))
                .arg("--import")
                .arg("tsx")
                .arg("src/server.ts")
                .current_dir(repo_root.join("apps").join("local-api"));
            command
        }
    };
    // The allocated port (bundled/remote). Repo mode spawns portless — the
    // checkout's .env owns PORT and the port file reports where it landed.
    if let Some(port) = spawn_port {
        command.env("PORT", port.to_string());
    }
    if let Some(port) = voice_port {
        command.env("VYNEL_VOICE_DAEMON_URL", format!("http://127.0.0.1:{port}"));
    }
    sidecar::hide_console_window(&mut command);
    command.spawn()
}

/// The engine's command: the shared pinned-runtime builder plus every
/// runtime path pinned ABSOLUTE into app_data (env.ts passes absolute values
/// through untouched).
fn bundled_daemon_command(bundled: &BundledLaunch, entry: &str) -> std::io::Result<Command> {
    let data_dir = bundled.app_data_dir.join("data");
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(bundled.app_data_dir.join("models"))?;

    let mut command = sidecar::bundled_runtime_command(bundled, entry, "daemon.log")?;
    command
        .env("DB_PATH", data_dir.join("vynel.db"))
        .env("VYNEL_ASSETS_DIR", bundled.engine_dir.join("assets"))
        .env("VYNEL_WEB_UI_DIST", &bundled.web_dir)
        .env(
            "VYNEL_EMBEDDINGS_CACHE_DIR",
            bundled.app_data_dir.join("models").join("embeddings"),
        )
        // The voice models' home beside the embeddings' — Settings → Voice
        // downloads here, and the voice sidecar reads here.
        .env(
            "VYNEL_VOICE_MODELS_DIR",
            bundled.app_data_dir.join("models").join("voice"),
        )
        .env("VYNEL_APP_VERSION", &bundled.app_version);
    Ok(command)
}

/// Wait for the engine, answering the port it ACTUALLY serves: the advertised
/// port file wins (repo mode's .env may differ from our expectation), then
/// the expected port.
fn wait_for_engine(expected_port: u16, timeout: Duration) -> Option<u16> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if let Some(port) = discover_running_engine() {
            return Some(port);
        }
        if port_is_listening(expected_port) {
            return Some(expected_port);
        }
        if sidecar::lock(&DAEMON).abandoned {
            return None;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    None
}
