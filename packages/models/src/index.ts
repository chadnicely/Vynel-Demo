// `@vynel/models` — the local models on this computer: what is installed,
// fetching what is not (with progress), and clearing what is. The catalog it
// reads lives in `@vynel/contracts/models/local-model-catalog`; the loaders
// (`@vynel/embeddings`, `@vynel/voice-engine`) read the same catalog, so the
// files this package checks are the files they open.

export {
  MODEL_STAMP_FILE,
  modelInstallDir,
  probeInstalledModel,
  removeInstalledModel,
  writeModelStamp,
  type InstalledModelProbe,
  type InstalledModelStamp,
} from './installed-model.js'
export { downloadToFile, type DownloadProgress, type DownloadToFileOptions } from './download-to-file.js'
export { installModelFromSource, type InstallModelOptions } from './install-model-from-source.js'
export {
  ModelDownloadRunner,
  type ModelDownloadJob,
  type ModelDownloadRunnerOptions,
  type ModelDownloadStatus,
  type ModelInstallRequest,
  type ModelInstaller,
} from './model-download-runner.js'
