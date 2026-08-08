// The desktop shell stays deliberately thin: window flags + (in release) the
// daemon sidecar lifecycle. All UI behavior lives in the local-web views the
// windows load — dev from Vite (devUrl), release from the daemon-hosted
// gateway (frontendDist http://127.0.0.1:18892, see local-api gateway.ts).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod browser;
mod daemon;
mod engine_config;
mod job_object;
mod launch_plan;
mod updater;
mod windows;

fn main() {
    // The voice daemon launches this exe with --jarvis-only on wake: only the
    // overlay window opens (the full app stays closed). The daemon sidecar is
    // still ensured in release — the overlay's UI is served by it.
    let jarvis_only = std::env::args().any(|arg| arg == "--jarvis-only");

    let context = tauri::generate_context!();
    // The updater's config lives only in tauri.release.conf.json (the
    // build-desktop.ts overlay); registering the plugin against a config
    // without that block panics at init — so builds on the base config (the
    // dev/voice overlay exe, `tauri dev`) simply run without an updater.
    let updater_configured = context.config().plugins.0.contains_key("updater");

    let mut builder = tauri::Builder::default()
        // FIRST plugin, deliberately: a second launch of any flavor routes
        // into this process instead of spawning a rival that could steal or
        // strand the daemon (the old --jarvis-only ownership hole). A full
        // second launch surfaces the main window; a --jarvis-only relaunch is
        // a no-op — the overlay already lives here and shows itself.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let second_launch_jarvis_only = args.iter().any(|arg| arg == "--jarvis-only");
            log::info!("second launch routed here (jarvis_only: {second_launch_jarvis_only})");
            if !second_launch_jarvis_only {
                if let Err(error) = windows::open_main_window(app) {
                    log::error!("failed to open the main window for a second launch: {error}");
                }
            }
        }))
        // Shell diagnostics: stdout when a terminal is attached, and the
        // platform log dir always — a windowed installed app swallows stderr,
        // and "it did not open" must be diagnosable from a file on disk.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some(String::from("vynel-shell")),
                    }),
                ])
                .build(),
        );
    if updater_configured {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            browser::browser_open,
            browser::browser_navigate,
            browser::browser_set_bounds,
            browser::browser_set_visible,
            browser::browser_close,
            engine_config::engine_get_config,
            engine_config::engine_set_config,
            engine_config::engine_restart_app,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            if cfg!(debug_assertions) {
                // Dev: `pnpm dev` owns the api + Vite — just open the windows.
                windows::create_windows(&handle, jarvis_only)?;
            } else {
                daemon::ensure_daemon_then_open_windows(handle.clone(), jarvis_only);
                // Not on a --jarvis-only cold launch: a modal update dialog
                // (and, on accept, the app killing itself to install) is
                // hostile mid-voice-interaction. The common main-window
                // launch path carries the update check — but only when the
                // plugin was registered above (handle.updater() panics on
                // unmanaged state, not a graceful Err).
                if !jarvis_only && updater_configured {
                    updater::check_for_updates_in_background(handle);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app. Without this, the hidden
            // jarvis overlay would keep a headless process (and the daemon
            // sidecar) alive after the user thinks Vynel is closed. The
            // single-instance plugin guarantees ONE process owns everything
            // (a second launch routes here), and the Job Object reaps the
            // daemon tree even when this handler never runs.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .build(context)
        .expect("failed to build the vynel desktop shell")
        .run(|_handle, event| {
            if let tauri::RunEvent::Exit = event {
                daemon::stop();
            }
        });
}
