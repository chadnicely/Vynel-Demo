import { join } from 'node:path'

/** Where the dev scripts keep voice models — gitignored, resolved from the
 *  repo root (the cwd of a `pnpm` script run). The daemon's
 *  `VYNEL_VOICE_MODELS_DIR` defaults to the same place. */
export const voiceModelsDir = join(process.cwd(), '.models', 'voice')
