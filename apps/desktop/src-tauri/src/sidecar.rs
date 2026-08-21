// Shared supervision for the shell's Node sidecars — the engine daemon
// (daemon.rs) and the voice daemon (voice_sidecar.rs). One state shape, one
// respawn loop, one builder for "the pinned runtime runs a compiled entry
// from resources\engine with its output on disk". Each sidecar owns its
// static state and its env; the stopping/abandoned protocol lives here.
//
// Shutdown is a hard kill (TerminateProcess): SQLite in WAL mode survives it,
// and the kill-on-close Job Object (job_object.rs) reaps the whole tree on
// ANY shell death; a graceful signal handshake remains a possible later
// refinement.

use crate::launch_plan::BundledLaunch;
use std::process::{Child, Command};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

pub const SPAWN_ATTEMPTS: u32 = 3;
const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;

pub struct SidecarState {
    pub child: Option<Child>,
    pub stopping: bool,
    // Set when the supervisor gives up (spawn attempts exhausted) so whoever
    // waits on this sidecar's port stops waiting for a bind that will never
    // come — the user gets a window (with a visible connection error) in
    // seconds, not after the full startup timeout.
    pub abandoned: bool,
}

impl SidecarState {
    pub const fn new() -> Self {
        Self {
            child: None,
            stopping: false,
            abandoned: false,
        }
    }
}

pub fn lock(state: &'static Mutex<SidecarState>) -> MutexGuard<'static, SidecarState> {
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Kill the sidecar on app exit. Safe to call when nothing was spawned.
pub fn stop(state: &'static Mutex<SidecarState>) {
    let mut sidecar = lock(state);
    sidecar.stopping = true;
    if let Some(mut child) = sidecar.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Spawn the sidecar and keep it alive on the CALLING thread: an unexpected
/// exit respawns with backoff, capped at SPAWN_ATTEMPTS total spawns (a
/// process that can't hold its port — runtime missing, port stolen, crash
/// loop — should not burn CPU forever; its log file is the visible symptom).
/// `spawn` receives the attempt number so a caller can re-allocate a port
/// lost to the probe-then-bind race.
pub fn supervise(
    state: &'static Mutex<SidecarState>,
    name: &str,
    log_file_name: &str,
    spawn: impl Fn(u32) -> std::io::Result<Child>,
) {
    for attempt in 1..=SPAWN_ATTEMPTS {
        if lock(state).stopping {
            return;
        }
        match spawn(attempt) {
            Ok(mut child) => {
                log::info!("{name} spawned (pid {})", child.id());
                #[cfg(windows)]
                crate::job_object::assign_daemon_to_kill_on_close_job(&child);
                // ONE lock acquisition for the stopping-check + store: stop()
                // may have run while the spawn was in flight, and a
                // check-then-store as two acquisitions would let the fresh
                // child slip past the kill (an orphan holding the port after
                // "exit"). The residual sliver — exit mid-CreateProcess — is
                // covered by the kill-on-close Job Object assigned above.
                {
                    let mut sidecar = lock(state);
                    if sidecar.stopping {
                        let _ = child.kill();
                        let _ = child.wait();
                        return;
                    }
                    sidecar.child = Some(child);
                }
                watch_until_exit(state, name);
                if lock(state).stopping {
                    return;
                }
                log::warn!("{name} exited unexpectedly (attempt {attempt}/{SPAWN_ATTEMPTS})");
            }
            Err(error) => {
                log::warn!("{name} spawn failed (attempt {attempt}/{SPAWN_ATTEMPTS}): {error}");
            }
        }
        std::thread::sleep(Duration::from_millis(500 * u64::from(attempt)));
    }
    log::error!(
        "giving up on the {name} after {SPAWN_ATTEMPTS} attempts — does it boot cleanly (logs\\{log_file_name} in the data home)?"
    );
    lock(state).abandoned = true;
}

/// Block until the supervised child exits (poll try_wait; the Child lives in
/// the mutex so stop() can kill it from the exit handler at any moment).
fn watch_until_exit(state: &'static Mutex<SidecarState>, name: &str) {
    loop {
        std::thread::sleep(Duration::from_millis(500));
        let mut sidecar = lock(state);
        if sidecar.stopping {
            return;
        }
        let Some(child) = sidecar.child.as_mut() else {
            return;
        };
        match child.try_wait() {
            Ok(Some(_status)) => {
                sidecar.child = None;
                return;
            }
            Ok(None) => {}
            Err(error) => {
                log::warn!("lost track of the {name} process: {error}");
                sidecar.child = None;
                return;
            }
        }
    }
}

/// The installed app's runtime: the pinned vynel-engine.exe (in
/// resources\engine, beside the bundles it runs) executes one compiled entry
/// from that directory. release.env carries the baked hub endpoint; the
/// user's config.env may override it; real env set by the caller always wins
/// over both (node --env-file never overrides existing env).
///
/// The process's pino output lands in <app_data>\logs\<log_file_name> — a
/// windowed shell has no console, and an installed-app failure must be
/// diagnosable from disk. Naive size rotation at boot keeps it bounded.
pub fn bundled_runtime_command(
    bundled: &BundledLaunch,
    entry: &str,
    log_file_name: &str,
) -> std::io::Result<Command> {
    let logs_dir = bundled.app_data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir)?;
    let log_path = logs_dir.join(log_file_name);
    if let Ok(metadata) = std::fs::metadata(&log_path) {
        if metadata.len() > MAX_LOG_BYTES {
            let rotated = logs_dir.join(format!("{log_file_name}.1"));
            if let Err(error) = std::fs::rename(&log_path, rotated) {
                log::warn!("{log_file_name} rotation failed (log will keep growing): {error}");
            }
        }
    }
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    let mut command = Command::new(bundled.engine_dir.join("vynel-engine.exe"));
    command
        .stdout(log_file.try_clone()?)
        .stderr(log_file)
        .arg(format!(
            "--env-file-if-exists={}",
            bundled.engine_dir.join("config").join("release.env").display()
        ))
        .arg(format!(
            "--env-file-if-exists={}",
            bundled.app_data_dir.join("config.env").display()
        ))
        .arg(entry)
        .current_dir(&bundled.engine_dir);
    Ok(command)
}

/// CREATE_NO_WINDOW: the shell is a GUI app; a spawned console process would
/// otherwise flash a console window on the user's desktop.
pub fn hide_console_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}
