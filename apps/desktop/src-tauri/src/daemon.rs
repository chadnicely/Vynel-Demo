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
// Shutdown is a hard kill (TerminateProcess): SQLite in WAL mode survives it,
// and the kill-on-close Job Object (job_object.rs) reaps the whole daemon
// tree on ANY shell death; a graceful signal handshake remains a possible
// later refinement. If another process already serves the port (e.g.
// `pnpm dev`), we attach to it instead of spawning. Shell diagnostics go
// through the log plugin: stdout when a terminal is attached, and the
// platform log dir always.

use crate::launch_plan::{resolve_launch_plan, BundledLaunch, LaunchPlan};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

// The canonical engine port — the PREFERRED first candidate, never an
// assumption: on an end-user machine anything may hold it (Hyper-V reserved
// blocks, another app), so every boot ALLOCATES (choose_engine_port) and the
// windows open wherever the engine actually landed. check-port-parity.ts
// pins this constant against contracts ports.ts.
const CANONICAL_ENGINE_PORT: u16 = 18892;
// Fallback scanning steps by the band stride so a chosen port never lands on
// another Vynel component's slot (contracts VYNEL_PORT_OFFSETS).
const PORT_SCAN_STRIDE: u16 = 10;
const PORT_SCAN_ATTEMPTS: u16 = 100;
const SPAWN_ATTEMPTS: u32 = 3;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

struct DaemonState {
    child: Option<Child>,
    stopping: bool,
    // Set when the supervisor gives up (no repo root, spawn attempts
    // exhausted) so the window-open path stops waiting for a port that will
    // never bind — the user gets a window (with a visible connection error)
    // in seconds, not after the full startup timeout.
    abandoned: bool,
}

static DAEMON: Mutex<DaemonState> = Mutex::new(DaemonState {
    child: None,
    stopping: false,
    abandoned: false,
});

/// Release-mode entry: make sure a daemon serves the port, then open the
/// windows on the main thread. Runs off-thread so setup() returns immediately
/// (a frozen event loop would never paint the windows).
pub fn ensure_daemon_then_open_windows(handle: tauri::AppHandle, jarvis_only: bool) {
    // Resolved here (not in the supervisor thread) — the plan needs the
    // AppHandle for app_data_dir + the packaged version.
    let plan = resolve_launch_plan(&handle);
    std::thread::spawn(move || {
        let expected_port = match discover_running_engine() {
            // A live engine already advertises a port (pnpm dev, a previous
            // shell, a shifted worktree band) — attach, never rival it.
            Some(port) => {
                log::info!("attaching to the engine already listening on 127.0.0.1:{port}");
                port
            }
            None => {
                // Repo mode: the checkout's .env owns PORT — spawn portless
                // and discover where the engine lands via its port file.
                // Bundled/remote: the shell allocates and passes PORT down.
                let spawn_port = match &plan {
                    Some(LaunchPlan::Repo(_)) | None => None,
                    Some(_) => Some(choose_engine_port()),
                };
                supervise_daemon(plan, spawn_port);
                spawn_port.unwrap_or(CANONICAL_ENGINE_PORT)
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
        crate::windows::set_engine_port(engine_port);
        let handle_for_windows = handle.clone();
        let created = handle.run_on_main_thread(move || {
            if let Err(error) = crate::windows::create_windows(&handle_for_windows, jarvis_only) {
                log::error!("failed to create windows: {error}");
            }
        });
        if let Err(error) = created {
            log::error!("failed to reach the main thread for window creation: {error}");
        }
    });
}

/// Kill the sidecar on app exit. Safe to call when nothing was spawned.
pub fn stop() {
    let mut daemon = lock_daemon();
    daemon.stopping = true;
    if let Some(mut child) = daemon.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn lock_daemon() -> std::sync::MutexGuard<'static, DaemonState> {
    DAEMON.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Spawn the daemon and keep it alive: an unexpected exit respawns with
/// backoff, capped at SPAWN_ATTEMPTS total spawns (a daemon that can't hold
/// the port — node missing, port stolen, crash loop — should not burn CPU
/// forever; the window's connection error is the visible symptom).
fn supervise_daemon(plan: Option<LaunchPlan>, spawn_port: Option<u16>) {
    std::thread::spawn(move || {
        let Some(plan) = plan else {
            log::error!(
                "no bundled payload beside the exe and no repo root found — set VYNEL_DESKTOP_REPO_ROOT or run the daemon yourself (`pnpm dev`)"
            );
            lock_daemon().abandoned = true;
            return;
        };
        for attempt in 1..=SPAWN_ATTEMPTS {
            if lock_daemon().stopping {
                return;
            }
            match spawn_daemon(&plan, spawn_port) {
                Ok(mut child) => {
                    log::info!("daemon spawned (pid {})", child.id());
                    #[cfg(windows)]
                    crate::job_object::assign_daemon_to_kill_on_close_job(&child);
                    // ONE lock acquisition for the stopping-check + store:
                    // stop() may have run while spawn_daemon was in flight,
                    // and a check-then-store as two acquisitions would let
                    // the fresh child slip past the kill (orphaned node
                    // holding the port after "exit"). The residual sliver —
                    // exit mid-CreateProcess — is covered by the
                    // kill-on-close Job Object assigned above.
                    {
                        let mut daemon = lock_daemon();
                        if daemon.stopping {
                            let _ = child.kill();
                            let _ = child.wait();
                            return;
                        }
                        daemon.child = Some(child);
                    }
                    watch_until_exit();
                    if lock_daemon().stopping {
                        return;
                    }
                    log::warn!("daemon exited unexpectedly (attempt {attempt}/{SPAWN_ATTEMPTS})");
                }
                Err(error) => {
                    log::warn!("daemon spawn failed (attempt {attempt}/{SPAWN_ATTEMPTS}): {error}");
                }
            }
            std::thread::sleep(Duration::from_millis(500 * u64::from(attempt)));
        }
        log::error!(
            "giving up on the daemon after {SPAWN_ATTEMPTS} attempts — is node on PATH, and does the engine boot cleanly (logs\\daemon.log)?"
        );
        lock_daemon().abandoned = true;
    });
}

/// Block until the supervised child exits (poll try_wait; the Child lives in
/// the mutex so stop() can kill it from the exit handler at any moment).
fn watch_until_exit() {
    loop {
        std::thread::sleep(Duration::from_millis(500));
        let mut daemon = lock_daemon();
        if daemon.stopping {
            return;
        }
        let Some(child) = daemon.child.as_mut() else {
            return;
        };
        match child.try_wait() {
            Ok(Some(_status)) => {
                daemon.child = None;
                return;
            }
            Ok(None) => {}
            Err(error) => {
                log::warn!("lost track of the daemon process: {error}");
                daemon.child = None;
                return;
            }
        }
    }
}

fn spawn_daemon(plan: &LaunchPlan, spawn_port: Option<u16>) -> std::io::Result<Child> {
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
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: the shell is a GUI app; the spawned engine process
        // would otherwise flash a console window on the user's desktop.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.spawn()
}

/// The installed app's daemon: the pinned vynel-engine.exe (in
/// resources\engine, beside the bundle it runs) executes the compiled
/// bundle with every runtime path pinned ABSOLUTE into app_data
/// (env.ts passes absolute values through untouched). release.env carries the
/// baked hub endpoint; the user's config.env may override it; real env set
/// here always wins over both (node --env-file never overrides existing env).
///
/// The daemon's pino output lands in <app_data>\logs\daemon.log — a windowed
/// shell has no console, and an installed-app failure must be diagnosable
/// from disk. Naive size rotation at boot keeps it bounded.
fn bundled_daemon_command(bundled: &BundledLaunch, entry: &str) -> std::io::Result<Command> {
    let data_dir = bundled.app_data_dir.join("data");
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(bundled.app_data_dir.join("models"))?;

    let logs_dir = bundled.app_data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir)?;
    let daemon_log_path = logs_dir.join("daemon.log");
    const MAX_DAEMON_LOG_BYTES: u64 = 10 * 1024 * 1024;
    if let Ok(metadata) = std::fs::metadata(&daemon_log_path) {
        if metadata.len() > MAX_DAEMON_LOG_BYTES {
            if let Err(error) = std::fs::rename(&daemon_log_path, logs_dir.join("daemon.log.1")) {
                log::warn!("daemon.log rotation failed (log will keep growing): {error}");
            }
        }
    }
    let daemon_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&daemon_log_path)?;

    let mut command = Command::new(bundled.engine_dir.join("vynel-engine.exe"));
    command
        .stdout(daemon_log.try_clone()?)
        .stderr(daemon_log);
    command
        .arg(format!(
            "--env-file-if-exists={}",
            bundled.engine_dir.join("config").join("release.env").display()
        ))
        .arg(format!(
            "--env-file-if-exists={}",
            bundled.app_data_dir.join("config.env").display()
        ))
        .arg(entry)
        .current_dir(&bundled.engine_dir)
        .env("DB_PATH", data_dir.join("vynel.db"))
        .env("VYNEL_ASSETS_DIR", bundled.engine_dir.join("assets"))
        .env("VYNEL_WEB_UI_DIST", &bundled.web_dir)
        .env(
            "VYNEL_EMBEDDINGS_CACHE_DIR",
            bundled.app_data_dir.join("models").join("embeddings"),
        )
        .env("VYNEL_APP_VERSION", &bundled.app_version);
    Ok(command)
}

/// Allocate the port a bundled/remote spawn binds: explicit env override
/// (the WSL/Docker escape hatch) → the canonical port when free → a
/// band-stride scan upward → whatever the OS hands out. Never assumes.
fn choose_engine_port() -> u16 {
    if let Ok(raw) = std::env::var("VYNEL_ENGINE_PORT") {
        match raw.parse::<u16>() {
            Ok(port) if port > 0 => return port,
            _ => log::warn!("ignoring unparseable VYNEL_ENGINE_PORT ({raw})"),
        }
    }
    let mut candidate = CANONICAL_ENGINE_PORT;
    for _ in 0..PORT_SCAN_ATTEMPTS {
        if port_is_free(candidate) {
            if candidate != CANONICAL_ENGINE_PORT {
                log::info!("canonical engine port busy — allocated 127.0.0.1:{candidate} instead");
            }
            return candidate;
        }
        candidate = candidate.saturating_add(PORT_SCAN_STRIDE);
    }
    // Docker/Hyper-V can reserve whole blocks — let the OS pick as the last
    // resort (its allocator skips reserved ranges by construction).
    match ephemeral_port() {
        Some(port) => {
            log::warn!("engine port scan exhausted — using OS-assigned 127.0.0.1:{port}");
            port
        }
        None => CANONICAL_ENGINE_PORT,
    }
}

/// The port a LIVE engine advertises (`~/.vynel/engine.port`, written by
/// local-api boot.ts) — verified by an actual TCP answer, so a stale file
/// left by a crash is never trusted.
fn discover_running_engine() -> Option<u16> {
    let port_file = user_data_dir()?.join("engine.port");
    let text = std::fs::read_to_string(port_file).ok()?;
    let record: serde_json::Value = serde_json::from_str(&text).ok()?;
    let port = u16::try_from(record.get("port")?.as_u64()?).ok()?;
    if port_is_listening(port) {
        Some(port)
    } else {
        None
    }
}

/// Mirrors the engine's `VYNEL_USER_DATA_DIR` default (`<home>/.vynel`,
/// contracts network/port-file.ts).
fn user_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".vynel"))
}

fn port_is_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn ephemeral_port() -> Option<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    Some(listener.local_addr().ok()?.port())
}

fn port_is_listening(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
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
        if lock_daemon().abandoned {
            return None;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    None
}
