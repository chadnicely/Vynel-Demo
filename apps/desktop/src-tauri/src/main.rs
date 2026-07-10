// The desktop shell stays deliberately thin: window flags + (in release) the
// daemon sidecar lifecycle. All UI behavior lives in the local-web views the
// windows load — dev from Vite (devUrl), release from the daemon-hosted
// gateway (frontendDist http://127.0.0.1:8998, see local-api gateway.ts).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod daemon;
mod windows;

fn main() {
    // The voice daemon launches this exe with --jarvis-only on wake: only the
    // overlay window opens (the full app stays closed). The daemon sidecar is
    // still ensured in release — the overlay's UI is served by it.
    let jarvis_only = std::env::args().any(|arg| arg == "--jarvis-only");

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            if cfg!(debug_assertions) {
                // Dev: `pnpm dev` owns the api + Vite — just open the windows.
                windows::create_windows(&handle, jarvis_only)?;
            } else {
                daemon::ensure_daemon_then_open_windows(handle, jarvis_only);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app. Without this, the hidden
            // jarvis overlay would keep a headless process (and the daemon
            // sidecar) alive after the user thinks Vynel is closed.
            // KNOWN HOLE (D2: single-instance plugin + explicit daemon
            // ownership): the promise only holds within ONE process. A
            // --jarvis-only process has no main window (so no exit path and
            // it may own the daemon), and a second full instance that
            // attached to the first's daemon loses it when the first closes.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the vynel desktop shell")
        .run(|_handle, event| {
            if let tauri::RunEvent::Exit = event {
                daemon::stop();
            }
        });
}
