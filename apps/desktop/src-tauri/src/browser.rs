// The embedded browser — a native child webview layered over the main
// window's browser-panel region. Native on purpose: an <iframe> obeys
// X-Frame-Options / frame-ancestors, so most real sites render blank; a
// child webview is a top-level browsing context and loads anything. The web
// layer owns ALL policy (which URL, where, when visible) — these commands
// are dumb hands, plus one hard guard: only http(s) may ever load.

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl};

const BROWSER_LABEL: &str = "embedded-browser";

fn parse_page_url(url: &str) -> Result<Url, String> {
    let parsed: Url = url
        .parse()
        .map_err(|_| format!("not a loadable url: {url}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!(
            "refusing to load a {other}: url — the browser view shows http(s) pages only"
        )),
    }
}

#[tauri::command]
pub fn browser_open(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let page = parse_page_url(&url)?;
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.navigate(page).map_err(|e| e.to_string())?;
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        // Atomic with the open: a URL change while a shell overlay is up must
        // not flash the page over the overlay for an IPC beat.
        return if visible {
            webview.show().map_err(|e| e.to_string())
        } else {
            webview.hide().map_err(|e| e.to_string())
        };
    }
    let window = app
        .get_window("main")
        .ok_or_else(|| "the main window is not open".to_string())?;
    let webview = window
        .add_child(
            // The commands guard what WE load; on_navigation guards where the
            // page takes ITSELF (redirects, links, meta refresh) — http(s)
            // stays, anything else is refused by the engine.
            WebviewBuilder::new(BROWSER_LABEL, WebviewUrl::External(page))
                .on_navigation(|url| matches!(url.scheme(), "http" | "https")),
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    if !visible {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let page = parse_page_url(&url)?;
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "the browser webview is not open".to_string())?;
    webview.navigate(page).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "the browser webview is not open".to_string())?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

// Hidden (not closed) while shell overlays are up — a native webview draws
// above ALL of the window's HTML, so the palette / dialogs / toasts would
// otherwise render underneath the page.
#[tauri::command]
pub fn browser_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "the browser webview is not open".to_string())?;
    if visible {
        webview.show().map_err(|e| e.to_string())
    } else {
        webview.hide().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn browser_close(app: AppHandle) -> Result<(), String> {
    // Closing an already-closed browser is a no-op, not an error — the web
    // layer calls this defensively on view close and unmount.
    let Some(webview) = app.get_webview(BROWSER_LABEL) else {
        return Ok(());
    };
    webview.close().map_err(|e| e.to_string())
}
