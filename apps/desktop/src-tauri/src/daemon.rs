// The local-api daemon sidecar (release builds only). D1 runs from a repo
// checkout: the daemon is `node --import tsx` inside apps/local-api, found by
// walking up from the exe (or VYNEL_DESKTOP_REPO_ROOT); D2's installer swaps
// this for the bundled runtime + built entry. The port probe doubles as the
// health check — the daemon binds 127.0.0.1:8998 as the LAST step of a
// successful boot (migrations + services first, see local-api server.ts).
//
// Shutdown is a hard kill (TerminateProcess): SQLite in WAL mode survives it;
// a graceful signal handshake is a D2 refinement. If another process already
// serves the port (e.g. `pnpm dev`), we attach to it instead of spawning.
// The eprintln! diagnostics here are only visible when launched from a
// terminal — a windowed release build swallows them (D2: the tauri log
// plugin, alongside the installer work).

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

// Matches the PORT default in apps/local-api/src/env.ts and the frontendDist
// URL in tauri.conf.json — the one address the whole sidecar mode hangs on.
const DAEMON_ADDRESS: &str = "127.0.0.1:8998";
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
    std::thread::spawn(move || {
        if !port_is_listening() {
            supervise_daemon();
        }
        if !wait_for_port(STARTUP_TIMEOUT) {
            eprintln!(
                "vynel: no daemon listening on {DAEMON_ADDRESS} after {STARTUP_TIMEOUT:?} — opening the window anyway (it will show a connection error)"
            );
        }
        let handle_for_windows = handle.clone();
        let created = handle.run_on_main_thread(move || {
            if let Err(error) = crate::windows::create_windows(&handle_for_windows, jarvis_only) {
                eprintln!("vynel: failed to create windows: {error}");
            }
        });
        if let Err(error) = created {
            eprintln!("vynel: failed to reach the main thread for window creation: {error}");
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
fn supervise_daemon() {
    std::thread::spawn(|| {
        let Some(repo_root) = resolve_repo_root() else {
            eprintln!(
                "vynel: could not locate the repo root from the exe path — set VYNEL_DESKTOP_REPO_ROOT or run the daemon yourself (`pnpm dev`)"
            );
            lock_daemon().abandoned = true;
            return;
        };
        for attempt in 1..=SPAWN_ATTEMPTS {
            if lock_daemon().stopping {
                return;
            }
            match spawn_daemon(&repo_root) {
                Ok(mut child) => {
                    eprintln!("vynel: daemon spawned (pid {})", child.id());
                    // ONE lock acquisition for the stopping-check + store:
                    // stop() may have run while spawn_daemon was in flight,
                    // and a check-then-store as two acquisitions would let
                    // the fresh child slip past the kill (orphaned node
                    // holding the port after "exit"). The residual sliver —
                    // exit mid-CreateProcess — needs a Windows Job Object
                    // with kill-on-close; that's the D2-robust answer.
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
                    eprintln!("vynel: daemon exited unexpectedly (attempt {attempt}/{SPAWN_ATTEMPTS})");
                }
                Err(error) => {
                    eprintln!("vynel: daemon spawn failed (attempt {attempt}/{SPAWN_ATTEMPTS}): {error}");
                }
            }
            std::thread::sleep(Duration::from_millis(500 * u64::from(attempt)));
        }
        eprintln!(
            "vynel: giving up on the daemon after {SPAWN_ATTEMPTS} attempts — is node on PATH, and is port {DAEMON_ADDRESS} free?"
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
                eprintln!("vynel: lost track of the daemon process: {error}");
                daemon.child = None;
                return;
            }
        }
    }
}

fn spawn_daemon(repo_root: &Path) -> std::io::Result<Child> {
    let env_file = repo_root.join(".env");
    let mut command = Command::new("node");
    command
        .arg(format!("--env-file-if-exists={}", env_file.display()))
        .arg("--import")
        .arg("tsx")
        .arg("src/server.ts")
        .current_dir(repo_root.join("apps").join("local-api"));
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: the shell is a GUI app; a spawned node.exe would
        // otherwise flash a console window on the user's desktop.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.spawn()
}

/// The repo root: env override first, else walk up from the exe until a dir
/// contains apps/local-api/src/server.ts (robust to the cargo target layout).
fn resolve_repo_root() -> Option<PathBuf> {
    if let Ok(overridden) = std::env::var("VYNEL_DESKTOP_REPO_ROOT") {
        let root = PathBuf::from(overridden);
        if daemon_entry_exists(&root) {
            return Some(root);
        }
        eprintln!("vynel: VYNEL_DESKTOP_REPO_ROOT does not contain apps/local-api — ignoring it");
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

fn port_is_listening() -> bool {
    let address = DAEMON_ADDRESS.parse().expect("static daemon address parses");
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

fn wait_for_port(timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if port_is_listening() {
            return true;
        }
        if lock_daemon().abandoned {
            return false;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}
