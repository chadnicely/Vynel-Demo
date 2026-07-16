# SSH servers — module notes

**Status:** design DRAFT 2026-07-17 — two forks below still need Chad; do not build past Gate 1
until they're answered. Arc ④ (final) of Tasks → Ask → Apps → SSH.

## Chad's advice so far (binding)

- Users add SSH servers at **workspace | global** scope; Claude connects to manage server
  configuration and app deployment.
- **Credentials live in the DB, ENCRYPTED at rest** (not the OS keyring) — "will be easy to
  manage; we will have a library how Claude can access with SSH without knowing it securely."
  Claude NEVER sees a key or password: it gets an `ssh_exec(serverId, command)`-shaped tool;
  Vynel owns the connection.
- **Users are non-technical and won't know commands** → ship a **verified notebook BOOK**
  teaching Claude how to work with servers safely (check before change, explain in plain
  language, prefer reversible steps, verify after) — rides the instructions leaf's verified
  book directory, zero new machinery.
- Pro tier (with Apps).

## Shape (draft)

- **Leaf `packages/ssh-servers`**: `ssh_servers` table (migration 0009) — id · userId ·
  nullable workspaceId (NULL = global) · name · host · port (default 22) · username ·
  authKind 'password' | 'private-key' · `encryptedCredentials` (AES-256-GCM blob: base64
  nonce+ciphertext+tag; NEVER returned, NEVER logged — the channels botCredentials discipline
  plus real encryption) · lastConnectedAt · createdAt/updatedAt.
- **Crypto**: a small `sealing/` concern — `sealSecret` / `openSecret` (AES-256-GCM,
  per-secret random nonce) against a 32-byte master key. WHERE THE MASTER KEY LIVES = FORK 1.
- **The connection layer**: `ssh2` (the repo's first ssh dep) behind an `SshConnectionPool`
  class (stateful registry precedent) — open-on-demand, reuse per server, idle-close (5 min),
  closeAll on shutdown. Commands run with a hard timeout (default 60s) + output cap.
- **Tools** (descriptor, `vynel-ssh`): `list_ssh_servers` (read) · `run_ssh_command(serverId,
  command, description)` — the `description` param is REQUIRED plain language ("restart the
  website") because the approval card shows THAT, not just the shell (FORK 2 decides when
  cards appear) · maybe `check_ssh_connection`. Registration/removal of servers = UI/routes
  only (secrets go in through the form, never through a tool).
- **Routes**: workspace+user-scoped twins like channels (`/ssh-servers`), featureGate('apps'…
  no — its own `ssh` feature key, pro). Create accepts the credential ONCE, seals it, returns
  a row WITHOUT it; there is deliberately no "read credential" surface anywhere.
- **UI**: SshServersSection (both scopes, pro-locked), add-server Modal (host/user/auth), a
  "test connection" button, last-connected chip. Approval cards render the plain-language
  description prominently with the raw command in small monospace beneath.
- **Notebook**: `notebooks/working-with-servers.md` (verified) — the server-work playbook.

## FORKS FOR CHAD (blocking)

1. **Where does the encryption master key live?** (a) OS keyring via the hub-account
   `@napi-rs/keyring` precedent — the SQLite file alone is useless if copied; survives only on
   this machine. (b) A key file under the app data dir with tight perms — simpler, but key +
   DB sit on the same disk. (c) Derive from a user passphrase — strongest, but adds an
   unlock step non-technical users will hate. Recommendation: (a).
2. **Approval granularity for `run_ssh_command`.** (a) Card EVERY command (safest; plain-
   language description makes cards readable). (b) Per-server "trusted" toggle (default
   cards-on; a loosened dev box runs free). (c) Card only a deny-list of dangerous patterns —
   NOT recommended (pattern lists lie). Recommendation: (a) to start, (b) as a fast follow if
   card fatigue shows up in real use.

## Deferred (deliberate, regardless of forks)

- SFTP/file transfer tools · port forwarding · multi-hop/bastion · host-key management UI
  (v1: trust-on-first-use with the fingerprint recorded on the row and pinned thereafter).
