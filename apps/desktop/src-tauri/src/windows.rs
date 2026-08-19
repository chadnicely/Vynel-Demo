// Window creation lives in code (not tauri.conf.json) because release builds
// must delay it until the daemon sidecar is listening — a config window would
// load the gateway URL before anything serves it and freeze an error page.
// Dev creates immediately (`pnpm dev` owns the servers).
//
// Release windows point at the RUNTIME engine port (set_engine_port, from the
// daemon's per-boot allocation) — the static frontendDist URL only covers the
// unset window (dev builds, a second launch racing daemon resolution).

use std::sync::atomic::{AtomicU16, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

// 0 = unresolved → WebviewUrl::App (devUrl in dev, frontendDist in release).
static ENGINE_PORT: AtomicU16 = AtomicU16::new(0);

/// Record where the engine actually listens — every window built after this
/// points there. Called by the daemon path once the port is resolved.
pub fn set_engine_port(port: u16) {
    ENGINE_PORT.store(port, Ordering::Relaxed);
}

fn webview_url(path: &str) -> WebviewUrl {
    match ENGINE_PORT.load(Ordering::Relaxed) {
        0 => WebviewUrl::App(path.into()),
        port => match format!("http://127.0.0.1:{port}{path}").parse() {
            Ok(url) => WebviewUrl::External(url),
            Err(error) => {
                log::error!("engine url failed to parse (port {port}): {error}");
                WebviewUrl::App(path.into())
            }
        },
    }
}

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
    WebviewWindowBuilder::new(handle, "main", webview_url("/"))
        .title("Vynel")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 600.0)
        // The shell draws its own title bar (AppTitleBar) — native decorations
        // on top of it doubled the window controls. Its buttons/drag-region need
        // the main-window capability (capabilities/main-window.json).
        .decorations(false)
        // Tauri's own drag-drop handler swallows native DnD in WebView2 on
        // Windows, which silently kills the page's HTML5 drag events (the
        // sidebar tree's reorder/regroup). Nothing in the web app listens to
        // Tauri's file-drop events, so the handler is pure loss here.
        .disable_drag_drop_handler()
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
    WebviewWindowBuilder::new(handle, "jarvis", webview_url("/jarvis"))
        .title("Vynel Jarvis")
        .inner_size(420.0, 560.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        // Hidden until a wake reveals it (JarvisView handleWake → reveal()) —
        // Tauri defaults to visible, which painted the overlay on every launch
        // with no wake at all. NOT .visible(jarvis_only): a wake-launched
        // overlay still reveals through the daemon's replayed wake.
        .visible(false)
        .build()?;

    // The desktop-control attention overlay — hidden until its web view reveals
    // it (first mcp__desktop__ step on the activity feed). Created in BOTH modes:
    // a voice-driven desktop turn must surface it with the main window closed.
    // skip_taskbar: unlike jarvis there is nothing to summon from the taskbar —
    // the feed shows/hides it. No set-focus permission (never steals typing).
    WebviewWindowBuilder::new(handle, "desktop-overlay", webview_url("/desktop-control"))
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
