// Gold auto-update flow (G3): silent check on startup + every 4 h →
// BACKGROUND download with progress events → an unobtrusive "restart to
// update" pill in the shell UI → on click, the daemon is stopped and the
// NSIS installer runs passive (/P /R relaunches the new version). Never a
// modal — the consensus UX of Telegram/Discord/Chrome/VS Code.
//
// Events to the webview (withGlobalTauri):
//   vynel://update-progress  { version, receivedBytes, totalBytes }
//   vynel://update-ready     { version }
// Commands: updater_pending_version (late-mounting UI catches up),
//           updater_install_now (the pill's restart click),
//           updater_check_now (the About dialog's on-demand check — same
//           path as the background loop, so a found update downloads and
//           arms the pill exactly as a scheduled check would).
//
// Builds without the updater config block (a plain `tauri build` outside
// build-desktop.ts, every dev shell) never register the plugin and never call
// this — main.rs gates both on the config carrying `plugins.updater`, because
// handle.updater() on an unregistered plugin panics rather than Err-ing.
// Update integrity comes from the minisign signature pinned in
// tauri.release.conf.json, not from this code.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;

const RECHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);
const PROGRESS_EMIT_STEP_BYTES: usize = 1024 * 1024;

// Whether main.rs registered the updater plugin (release overlay config only).
// updater_check_now must know: touching the updater on an unregistered plugin
// panics rather than Err-ing, and unlike the background check the command is
// reachable in every build.
static UPDATER_CONFIGURED: AtomicBool = AtomicBool::new(false);

// One check at a time — a manual check racing the scheduled one would
// download the same bytes twice.
static CHECK_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

pub fn set_configured(configured: bool) {
    UPDATER_CONFIGURED.store(configured, Ordering::SeqCst);
}

enum CheckOutcome {
    /// An update is downloaded and parked — the version waiting to install.
    Ready(String),
    /// The check ran and this build is the latest.
    Current,
    /// The check could not answer — not configured, offline, or a failed
    /// download. The reason is already logged; it also travels to the caller.
    Unavailable(String),
}

struct PendingUpdate {
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}

static PENDING_UPDATE: Mutex<Option<PendingUpdate>> = Mutex::new(None);

fn lock_pending() -> std::sync::MutexGuard<'static, Option<PendingUpdate>> {
    PENDING_UPDATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn check_for_updates_in_background(handle: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let outcome = tauri::async_runtime::block_on(check_and_download(&handle));
        if matches!(outcome, CheckOutcome::Ready(_)) {
            // The update sits in memory until the user restarts — re-checking
            // would race a second download against the pending one.
            return;
        }
        std::thread::sleep(RECHECK_INTERVAL);
    });
}

/// One silent check; a found update downloads in the background and parks in
/// PENDING_UPDATE. Serialized by CHECK_IN_FLIGHT — the loser reports
/// Unavailable rather than downloading the same bytes twice.
async fn check_and_download(handle: &tauri::AppHandle) -> CheckOutcome {
    if let Some(pending) = lock_pending().as_ref() {
        return CheckOutcome::Ready(pending.update.version.clone());
    }
    if CHECK_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return CheckOutcome::Unavailable(String::from("an update check is already running"));
    }
    let outcome = run_check_and_download(handle).await;
    CHECK_IN_FLIGHT.store(false, Ordering::SeqCst);
    outcome
}

async fn run_check_and_download(handle: &tauri::AppHandle) -> CheckOutcome {
    // The builder (not handle.updater()) so the pre-exit hook is attached:
    // on Windows install() exits the process, and NSIS only kills Vynel.exe —
    // an engine left running would hold old code against a newly-migrated DB.
    let updater = match handle
        .updater_builder()
        .on_before_exit(|| {
            log::info!("update install imminent — stopping the engine");
            crate::daemon::stop();
        })
        .build()
    {
        Ok(updater) => updater,
        Err(error) => {
            log::info!("updater not configured for this build: {error}");
            return CheckOutcome::Unavailable(format!("updater not configured for this build: {error}"));
        }
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            log::info!("update check: already current");
            return CheckOutcome::Current;
        }
        Err(error) => {
            log::warn!("update check failed: {error}");
            return CheckOutcome::Unavailable(format!("update check failed: {error}"));
        }
    };

    let version = update.version.clone();
    log::info!("update available: {version} — downloading in the background");
    let progress_version = version.clone();
    let progress_handle = handle.clone();
    let mut received: usize = 0;
    let mut last_emitted: usize = 0;
    let bytes = match update
        .download(
            move |chunk, total| {
                received += chunk;
                if received - last_emitted >= PROGRESS_EMIT_STEP_BYTES {
                    last_emitted = received;
                    let _ = progress_handle.emit(
                        "vynel://update-progress",
                        serde_json::json!({
                            "version": progress_version,
                            "receivedBytes": received,
                            "totalBytes": total,
                        }),
                    );
                }
            },
            || {},
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(error) => {
            log::warn!("update {version} download failed: {error} — retrying next check");
            return CheckOutcome::Unavailable(format!("the download failed: {error}"));
        }
    };

    log::info!("update {version} downloaded — waiting for the user to restart");
    *lock_pending() = Some(PendingUpdate { update, bytes });
    let _ = handle.emit("vynel://update-ready", serde_json::json!({ "version": version }));
    CheckOutcome::Ready(version)
}

/// What updater_check_now answers. `failed` is a TRANSIENT no (offline, a
/// download that broke, a colliding check) — distinct from the Err below,
/// which means this build can never check. The dialog's copy hangs on that
/// difference: "try again" vs "not in this build".
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CheckNowAnswer {
    Ready { version: String },
    Current,
    Failed { reason: String },
}

/// The About dialog's on-demand check. Ready = an update is downloaded and
/// waiting to restart into (the update-ready event fired too, so the pill
/// arms exactly as a scheduled check would); Err = this build cannot check
/// at all (no updater config — dev shells).
#[tauri::command]
pub async fn updater_check_now(handle: tauri::AppHandle) -> Result<CheckNowAnswer, String> {
    if !UPDATER_CONFIGURED.load(Ordering::SeqCst) {
        return Err(String::from("updates are not available in this build"));
    }
    match check_and_download(&handle).await {
        CheckOutcome::Ready(version) => Ok(CheckNowAnswer::Ready { version }),
        CheckOutcome::Current => Ok(CheckNowAnswer::Current),
        CheckOutcome::Unavailable(reason) => Ok(CheckNowAnswer::Failed { reason }),
    }
}

/// The pill's state query — a webview that mounts (or reloads) after
/// update-ready fired catches up here.
#[tauri::command]
pub fn updater_pending_version() -> Option<String> {
    lock_pending().as_ref().map(|pending| pending.update.version.clone())
}

/// The pill's restart click. On Windows install() never returns on success:
/// the on_before_exit hook stops the engine, the plugin exits the app, and
/// the passive NSIS run relaunches the new version. The parked update stays
/// in place (no take()) — a FAILED install leaves the pill armed for a
/// retry instead of dead-ending until the next launch. No await points, so
/// holding the lock across the blocking install is safe (the download
/// thread already finished the moment anything was parked).
#[tauri::command]
pub async fn updater_install_now() -> Result<(), String> {
    let guard = lock_pending();
    let Some(pending) = guard.as_ref() else {
        return Err(String::from("no downloaded update is pending"));
    };
    let version = pending.update.version.clone();
    log::info!("installing update {version}");
    pending.update.install(&pending.bytes).map_err(|error| {
        log::error!("update {version} failed to install: {error}");
        format!("update failed to install: {error}")
    })
}
