// THE home of Vynel's ports. Change a port HERE and every TypeScript consumer
// follows (env defaults, the remote engine's env, the tunnel). Two copies
// live outside TypeScript's reach — `apps/desktop/src-tauri/src/daemon.rs`
// and `tauri.conf.json`'s frontendDist — and `scripts/src/generators/
// check-port-parity.ts` (wired into `pnpm test:parity`) fails the gate if
// they ever drift.

/** The engine daemon's port — local desktop, remote server, and the tunnel's
 *  local end all use the SAME number, so switching modes never re-plumbs a
 *  URL anywhere. */
export const VYNEL_ENGINE_PORT = 18892

/** The voice daemon's loopback overlay channel. */
export const VYNEL_VOICE_DAEMON_PORT = 18893
