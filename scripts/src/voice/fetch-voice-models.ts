import {
  DEFAULT_TTS_MODEL_ID,
  LOCAL_MODELS,
  getLocalModelOrThrow,
} from '@vynel/contracts/models/local-model-catalog'
import { installModelFromSource, probeInstalledModel } from '@vynel/models'
import { voiceModelsDir } from './voice-models-dir.js'

// Download a voice model into the gitignored `.models/voice/` — the same
// installer the Settings → Voice screen runs, from the same catalog. Idempotent
// (skips a model whose files are all present). Usage:
// `pnpm voice:fetch-models [model]` (default: kokoro); models: every
// non-embedding id in the catalog.

async function main(): Promise<void> {
  const name = process.argv[2] ?? DEFAULT_TTS_MODEL_ID
  const entry = getLocalModelOrThrow(name)
  if (entry.kind === 'embedding') {
    const voiceIds = LOCAL_MODELS.filter((row) => row.kind !== 'embedding').map((row) => row.id)
    throw new Error(`"${name}" is the embedding model — this fetches voice models: ${voiceIds.join(', ')}.`)
  }

  const before = await probeInstalledModel(voiceModelsDir, entry)
  if (before.installed) {
    console.log(`[voice:models] "${name}" already present under ${voiceModelsDir} — nothing to do.`)
    return
  }

  console.log(`[voice:models] downloading "${name}" (~${Math.round(entry.approxBytes / 1_000_000)} MB) …`)
  let lastReported = -1
  await installModelFromSource(voiceModelsDir, entry, {
    onProgress: ({ bytes, total }) => {
      const percent = total === null ? null : Math.floor((bytes / total) * 100)
      if (percent !== null && percent !== lastReported && percent % 10 === 0) {
        lastReported = percent
        console.log(`[voice:models]   ${percent}%`)
      }
    },
  })
  console.log(`[voice:models] ready → ${voiceModelsDir}/${entry.folder}`)
}

main().catch((error: unknown) => {
  console.error(`[voice:models] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
