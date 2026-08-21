// The voice daemon sidecar (installed app only — the payload bundles
// dist/voice.mjs for the desktop target, never for a server). It boots IDLE
// when no voice model is installed: Settings → Voice downloads into
// <app_data>\models\voice and the engine's /voice/reload brings the voice
// live without a restart, so a fresh install never crash-loops on "model
// missing". Spawned AFTER the engine answers (its brain client and the dock
// URL both point at the engine); its port was allocated BEFORE the engine
// spawned, because the engine reads VYNEL_VOICE_DAEMON_URL at boot.

use crate::launch_plan::BundledLaunch;
use crate::sidecar::{self, SidecarState};
use std::process::Child;
use std::sync::Mutex;

static VOICE: Mutex<SidecarState> = Mutex::new(SidecarState::new());

pub fn start(bundled: BundledLaunch, engine_port: u16, voice_port: u16) {
    std::thread::spawn(move || {
        sidecar::supervise(&VOICE, "voice daemon", "voice.log", |_attempt| {
            spawn_voice(&bundled, engine_port, voice_port)
        });
    });
}

pub fn stop() {
    sidecar::stop(&VOICE);
}

fn spawn_voice(bundled: &BundledLaunch, engine_port: u16, voice_port: u16) -> std::io::Result<Child> {
    let engine_url = format!("http://127.0.0.1:{engine_port}");
    // The display dock IS this shell: a wake launches this exe argless (one
    // process builds the main window AND the dock webview; a second launch
    // routes into the resident app through the single-instance plugin) and
    // the dock page is the gateway-hosted SPA route.
    let dock_app = std::env::current_exe()?;
    let mut command = sidecar::bundled_runtime_command(bundled, "dist/voice.mjs", "voice.log")?;
    command
        .env("VYNEL_VOICE_DAEMON_PORT", voice_port.to_string())
        .env("VYNEL_API_URL", &engine_url)
        .env(
            "VYNEL_VOICE_MODELS_DIR",
            bundled.app_data_dir.join("models").join("voice"),
        )
        .env("VYNEL_VOICE_DOCK_WINDOW", "1")
        .env("VYNEL_VOICE_DOCK_URL", format!("{engine_url}/display-dock"))
        .env("VYNEL_VOICE_DOCK_APP", dock_app);
    sidecar::hide_console_window(&mut command);
    command.spawn()
}
