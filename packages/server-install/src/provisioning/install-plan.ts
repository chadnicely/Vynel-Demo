// The remote layout + the two files provisioning writes, computed from the
// server's real $HOME (systemd's EnvironmentFile does NOT expand variables,
// so every path must land absolute). Pure composers — unit-tested directly.
//
//   <home>/.vynel/engine/       the extracted payload (replaced on update)
//   <home>/.vynel/data/         DB + models (survives updates)
//   <home>/.vynel/engine.env    the daemon env (0600 — carries the bearer)
//   <home>/.vynel/master.key    sealing master key (minted by the daemon)

import { VYNEL_ENGINE_PORT } from '@vynel/contracts/network/ports'

export const ENGINE_SERVICE_NAME = 'vynel-engine'
export const REMOTE_ENGINE_PORT = VYNEL_ENGINE_PORT

export interface RemoteInstallPlan {
  vynelDir: string
  engineDir: string
  dataDir: string
  archivePath: string
  envFilePath: string
  unitFilePath: string
  /** The SDK's per-platform claude binary — needs its exec bit restored. */
  claudeBinaryPath: string
  nodeBinaryPath: string
  serverEntryPath: string
}

export function composeInstallPlan(home: string, targetCpu: 'x64' | 'arm64'): RemoteInstallPlan {
  const vynelDir = `${home}/.vynel`
  const engineDir = `${vynelDir}/engine`
  return {
    vynelDir,
    engineDir,
    dataDir: `${vynelDir}/data`,
    archivePath: `${vynelDir}/payload.tar.gz`,
    envFilePath: `${vynelDir}/engine.env`,
    unitFilePath: `${home}/.config/systemd/user/${ENGINE_SERVICE_NAME}.service`,
    claudeBinaryPath: `${engineDir}/backend/node_modules/@anthropic-ai/claude-agent-sdk-linux-${targetCpu}/claude`,
    nodeBinaryPath: `${engineDir}/node`,
    serverEntryPath: `${engineDir}/backend/dist/server.mjs`,
  }
}

export function composeEngineEnvFile(
  plan: RemoteInstallPlan,
  input: { authToken: string; appVersion: string },
): string {
  return [
    `PORT=${REMOTE_ENGINE_PORT}`,
    `DB_PATH=${plan.dataDir}/vynel.db`,
    `VYNEL_ASSETS_DIR=${plan.engineDir}/backend/assets`,
    `VYNEL_WEB_UI_DIST=${plan.engineDir}/web`,
    `VYNEL_EMBEDDINGS_CACHE_DIR=${plan.dataDir}/models`,
    `VYNEL_USER_DATA_DIR=${plan.vynelDir}/user`,
    `VYNEL_MASTER_KEY_FILE=${plan.vynelDir}/master.key`,
    `VYNEL_AUTH_TOKEN=${input.authToken}`,
    'VYNEL_REMOTE_ENGINE=1',
    `VYNEL_APP_VERSION=${input.appVersion}`,
    'LOG_LEVEL=info',
    '',
  ].join('\n')
}

export function composeSystemdUnit(plan: RemoteInstallPlan): string {
  return [
    '[Unit]',
    'Description=Vynel Engine (remote daemon)',
    'After=network-online.target',
    '',
    '[Service]',
    `ExecStart=${plan.nodeBinaryPath} ${plan.serverEntryPath}`,
    `WorkingDirectory=${plan.engineDir}/backend`,
    `EnvironmentFile=${plan.envFilePath}`,
    'Restart=on-failure',
    'RestartSec=3',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}
