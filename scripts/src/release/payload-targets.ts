// The release targets the payload pipeline can build for. win-x64 feeds the
// desktop installer (Phase B); the linux targets feed the SSH server install
// (Phase D). Node version pinned exactly — the runtime ships inside the
// payload, so every user runs the version we tested.

export const PINNED_NODE_VERSION = '22.18.0'

export type PayloadTargetId = 'win-x64' | 'linux-x64' | 'linux-arm64'

export type PayloadTarget = {
  id: PayloadTargetId
  /** pnpm supportedArchitectures — which native prebuilds the install fetches. */
  os: 'win32' | 'linux'
  cpu: 'x64' | 'arm64'
  /** nodejs.org dist file name for the pinned runtime. */
  nodeArchiveName: string
  /** Path of the node binary inside the archive. */
  nodeBinaryInArchive: string
  /** Staged binary name at the payload root. */
  stagedNodeName: 'node.exe' | 'node'
}

export const PAYLOAD_TARGETS: Record<PayloadTargetId, PayloadTarget> = {
  'win-x64': {
    id: 'win-x64',
    os: 'win32',
    cpu: 'x64',
    nodeArchiveName: `node-v${PINNED_NODE_VERSION}-win-x64.zip`,
    nodeBinaryInArchive: `node-v${PINNED_NODE_VERSION}-win-x64/node.exe`,
    stagedNodeName: 'node.exe',
  },
  'linux-x64': {
    id: 'linux-x64',
    os: 'linux',
    cpu: 'x64',
    nodeArchiveName: `node-v${PINNED_NODE_VERSION}-linux-x64.tar.xz`,
    nodeBinaryInArchive: `node-v${PINNED_NODE_VERSION}-linux-x64/bin/node`,
    stagedNodeName: 'node',
  },
  'linux-arm64': {
    id: 'linux-arm64',
    os: 'linux',
    cpu: 'arm64',
    nodeArchiveName: `node-v${PINNED_NODE_VERSION}-linux-arm64.tar.xz`,
    nodeBinaryInArchive: `node-v${PINNED_NODE_VERSION}-linux-arm64/bin/node`,
    stagedNodeName: 'node',
  },
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
