// The desktop shell is deliberately thin: the whole Jarvis overlay behavior
// (show on wake, hide on session end, positioning) lives in the /jarvis web
// view via the withGlobalTauri window API — the Rust side just hosts it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run the vynel desktop shell");
}
