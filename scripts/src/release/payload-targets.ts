// The release targets the payload pipeline can build for. win-x64 feeds the
// desktop installer (Phase B); the linux targets feed the SSH server install
// (Phase D). Node version pinned exactly — the runtime ships inside the
// payload, so every user runs the version we tested.

import { join as joinPath } from 'node:path'

export const PINNED_NODE_VERSION = '22.18.0'

export type PayloadTargetId = 'win-x64' | 'linux-x64' | 'linux-arm64'

export type PayloadTarget = {
  id: PayloadTargetId
  /** pnpm supportedArchitectures — which native prebuilds the install fetches. */
  os: 'win32' | 'linux'
  cpu: 'x64' | 'arm64'
  /** pnpm supportedArchitectures libc — Phase D v1 is glibc-only (release-plan risk #4). */
  libc?: 'glibc'
  /** nodejs.org dist file name for the pinned runtime. */
  nodeArchiveName: string
  /** Path of the node binary inside the archive. */
  nodeBinaryInArchive: string
  /**
   * Staged binary name at the payload root. win-x64 renames the runtime to
   * `vynel-engine.exe` — Task Manager, AV dialogs, and the install dir show a
   * Vynel-owned name instead of a mystery "Node.js" process. A pure rename
   * keeps the OpenJS Authenticode signature valid (it covers content, not
   * filename); the version-resource rebrand waits for our own signing (G2).
   * Linux targets stay `node`: the server-install systemd unit's ExecStart
   * (`<engine>/node`) is a shipped contract.
   */
  stagedNodeName: 'vynel-engine.exe' | 'node'
}

export const PAYLOAD_TARGETS: Record<PayloadTargetId, PayloadTarget> = {
  'win-x64': {
    id: 'win-x64',
    os: 'win32',
    cpu: 'x64',
    nodeArchiveName: `node-v${PINNED_NODE_VERSION}-win-x64.zip`,
    nodeBinaryInArchive: `node-v${PINNED_NODE_VERSION}-win-x64/node.exe`,
    stagedNodeName: 'vynel-engine.exe',
  },
  'linux-x64': {
    id: 'linux-x64',
    os: 'linux',
    cpu: 'x64',
    libc: 'glibc',
    nodeArchiveName: `node-v${PINNED_NODE_VERSION}-linux-x64.tar.xz`,
    nodeBinaryInArchive: `node-v${PINNED_NODE_VERSION}-linux-x64/bin/node`,
    stagedNodeName: 'node',
  },
  'linux-arm64': {
    id: 'linux-arm64',
    os: 'linux',
    cpu: 'arm64',
    libc: 'glibc',
    nodeArchiveName: `node-v${PINNED_NODE_VERSION}-linux-arm64.tar.xz`,
    nodeBinaryInArchive: `node-v${PINNED_NODE_VERSION}-linux-arm64/bin/node`,
    stagedNodeName: 'node',
  },
}

/**
 * Where a target's payload is assembled. win-x64 stays at the tauri path the
 * desktop bundle maps as resources; linux targets get their own root so a
 * server-payload build never clobbers the installer's staged payload.
 */
export function resolvePayloadDir(repoRoot: string, target: PayloadTarget): string {
  if (target.os === 'win32') {
    return joinPath(repoRoot, 'apps', 'desktop', 'src-tauri', 'payload')
  }
  return joinPath(repoRoot, 'dist-payloads', target.id)
}

export function resolvePayloadTarget(raw: string | undefined): PayloadTarget {
  const id = (raw ?? 'win-x64') as PayloadTargetId
  const target = PAYLOAD_TARGETS[id]
  if (target === undefined) {
    throw new Error(
      `Unknown payload target "${raw}". Valid targets: ${Object.keys(PAYLOAD_TARGETS).join(', ')}.`,
    )
  }
  return target
}
