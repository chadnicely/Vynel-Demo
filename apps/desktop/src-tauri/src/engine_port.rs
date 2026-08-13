// Engine-port allocation + discovery for the shell (daemon.rs drives it).
// The canonical port is the PREFERRED first candidate, never an assumption:
// on an end-user machine anything may hold it (Hyper-V reserved blocks,
// another app), so every boot allocates and the windows open wherever the
// engine actually landed. check-port-parity.ts pins the constants below
// against `packages/contracts/src/network/ports.ts`.

use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

pub const CANONICAL_ENGINE_PORT: u16 = 18892;
// Fallback scanning steps by the band stride (contracts
// VYNEL_PORT_BAND_STRIDE) so a chosen port never lands on another Vynel
// component's slot.
const PORT_SCAN_STRIDE: u16 = 10;
const PORT_SCAN_ATTEMPTS: u16 = 100;

/// Allocate the port a bundled/remote spawn binds: explicit env override
/// (the WSL/Docker escape hatch) → the canonical port when free → a
/// band-stride scan upward → whatever the OS hands out. Never assumes.
pub fn choose_engine_port() -> u16 {
    if let Ok(raw) = std::env::var("VYNEL_ENGINE_PORT") {
        match raw.parse::<u16>() {
            Ok(port) if port > 0 => return port,
            _ => log::warn!("ignoring unparseable VYNEL_ENGINE_PORT ({raw})"),
        }
    }
    let mut candidate = CANONICAL_ENGINE_PORT;
    for _ in 0..PORT_SCAN_ATTEMPTS {
        if port_is_free(candidate) {
            if candidate != CANONICAL_ENGINE_PORT {
                log::info!("canonical engine port busy — allocated 127.0.0.1:{candidate} instead");
            }
            return candidate;
        }
        candidate = candidate.saturating_add(PORT_SCAN_STRIDE);
    }
    // Docker/Hyper-V can reserve whole blocks — let the OS pick as the last
    // resort (its allocator skips reserved ranges by construction).
    match ephemeral_port() {
        Some(port) => {
            log::warn!("engine port scan exhausted — using OS-assigned 127.0.0.1:{port}");
            port
        }
        None => CANONICAL_ENGINE_PORT,
    }
}

/// The port a LIVE canonical-band engine advertises (`~/.vynel/engine.port`,
/// written by local-api boot.ts) — verified by an actual TCP answer, so a
/// stale file left by a crash is never trusted. Shifted bands (worktrees)
/// advertise under band-suffixed names this shell deliberately ignores.
pub fn discover_running_engine() -> Option<u16> {
    let port_file = user_data_dir()?.join("engine.port");
    let text = std::fs::read_to_string(port_file).ok()?;
    let record: serde_json::Value = serde_json::from_str(&text).ok()?;
    let port = u16::try_from(record.get("port")?.as_u64()?).ok()?;
    if port_is_listening(port) {
        Some(port)
    } else {
        None
    }
}

/// Mirrors the engine's `VYNEL_USER_DATA_DIR` default (`<home>/.vynel`,
/// contracts network/port-file.ts).
fn user_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".vynel"))
}

fn port_is_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn ephemeral_port() -> Option<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    Some(listener.local_addr().ok()?.port())
}

pub fn port_is_listening(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}
