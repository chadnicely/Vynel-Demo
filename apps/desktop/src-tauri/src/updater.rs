// Check-on-startup auto-update. Non-blocking: runs on its own thread after
// the windows open, so a slow or offline releases endpoint never delays
// launch. Found update → native yes/no prompt → download + install (NSIS
// passive; per-user install, no elevation) → the plugin exits the app on
// Windows and the new version starts fresh.
//
// Debug builds and release builds without baked updater endpoints (a plain
// `tauri build` outside build-desktop.ts) fail the check harmlessly — logged,
// never surfaced. Update integrity comes from the minisign signature pinned
// in tauri.release.conf.json, not from this code.

use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

pub fn check_for_updates_in_background(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let updater = match handle.updater() {
            Ok(updater) => updater,
            Err(error) => {
                log::info!("updater not configured for this build: {error}");
                return;
            }
        };
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => {
                log::info!("update check: already current");
                return;
            }
            Err(error) => {
                log::warn!("update check failed: {error}");
                return;
            }
        };

        let version = update.version.clone();
        log::info!("update available: {version}");
        let install = handle
            .dialog()
            .message(format!(
                "Vynel {version} is available. Update now?\n\nThe app restarts when the update finishes."
            ))
            .title("Vynel update")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                String::from("Update now"),
                String::from("Later"),
            ))
            .blocking_show();
        if !install {
            log::info!("update {version} declined — will offer again next launch");
            return;
        }

        // The install path must leave a trace on disk: on Windows the plugin
        // exits the process inside download_and_install, so these callbacks
        // are the last log lines a successful update ever writes.
        log::info!("downloading update {version}");
        let downloaded_version = version.clone();
        match update
            .download_and_install(
                |_chunk, _total| {},
                move || log::info!("update {downloaded_version} downloaded — installing"),
            )
            .await
        {
            // This arm only runs on platforms where the app keeps running.
            Ok(()) => handle.restart(),
            Err(error) => log::error!("update {version} failed to install: {error}"),
        }
    });
}
