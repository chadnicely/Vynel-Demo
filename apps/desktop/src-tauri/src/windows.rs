// Window creation lives in code (not tauri.conf.json) because release builds
// must delay it until the daemon sidecar is listening — a config window would
// load http://127.0.0.1:8998 before anything serves it and freeze an error
// page. Dev creates immediately (`pnpm dev` owns the servers).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Bring the main window to the user — the single-instance path: a second
/// launch routes here instead of starting a new process, so a --jarvis-only
/// resident (which has no main window) simply gains one, and a minimized app
/// comes forward. The daemon keeps its one owner either way.
pub fn open_main_window(handle: &AppHandle) -> tauri::Result<()> {
    if let Some(main) = handle.get_webview_window("main") {
        main.unminimize().ok();
        main.show().ok();
        main.set_focus().ok();
        return Ok(());
    }
    build_main_window(handle)
}

fn build_main_window(handle: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(handle, "main", WebviewUrl::App("/".into()))
        .title("Vynel")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        .build()?;
    Ok(())
}

pub fn create_windows(handle: &AppHandle, jarvis_only: bool) -> tauri::Result<()> {
    if !jarvis_only {
        build_main_window(handle)?;
    }

    // Flags mirror the pre-D1 tauri.conf.json jarvis window verbatim — the
    // overlay web view manages its own show/hide/park/drag behavior
    // (local-web composables/voice/tauri-overlay-window.ts).
    WebviewWindowBuilder::new(handle, "jarvis", WebviewUrl::App("/jarvis".into()))
        .title("Vynel Jarvis")
        .inner_size(420.0, 560.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(false)
        .build()?;

    // The desktop-control attention overlay — hidden until its web view reveals
    // it (first mcp__desktop__ step on the activity feed). Created in BOTH modes:
    // a voice-driven desktop turn must surface it with the main window closed.
    // skip_taskbar: unlike jarvis there is nothing to summon from the taskbar —
    // the feed shows/hides it. No set-focus permission (never steals typing).
    WebviewWindowBuilder::new(
        handle,
        "desktop-overlay",
        WebviewUrl::App("/desktop-control".into()),
    )
    .title("Claude on your desktop")
    .inner_size(380.0, 360.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false)
    .build()?;

    Ok(())
}
