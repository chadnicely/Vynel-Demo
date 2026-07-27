// Phase 1 entry point. Import-light ON PURPOSE: route modules load instruction
// content at import time (the speak tool's markdown description), so in bundled
// mode the shipped content root must be set before ANY feature module
// evaluates. Env + the seam first; the real server stays behind a dynamic
// import, which defers its whole module graph until after this runs.

import { join } from 'node:path'
import { setInstructionsContentRoot } from '@vynel/instructions/content-root'
import { loadEnv } from './env.js'

const env = loadEnv()
if (env.VYNEL_ASSETS_DIR !== undefined) {
  setInstructionsContentRoot(join(env.VYNEL_ASSETS_DIR, 'instructions'))
}

const { boot } = await import('./boot.js')

boot().catch((err) => {
  // Pino may not be wired before crash — use console.error so the dev sees it.
  // eslint-disable-next-line no-console -- pre-pino bootstrap failure
  console.error('api boot failed:', err)
  // eslint-disable-next-line n/no-process-exit -- boot-failure exit
  process.exit(1)
})
