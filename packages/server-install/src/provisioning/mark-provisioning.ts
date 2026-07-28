// Reset a settled install back to 'provisioning' so a re-run (the D5
// desktop-driven update) reports its steps from a clean slate instead of
// showing the previous run's step or error. Sync; the pipeline itself stamps
// every step after this.

import type { Database } from '@vynel/db'
import * as installsRepository from '../repositories/index.js'
import type { ServerInstall } from '../repositories/index.js'

export function markServerInstallProvisioning(db: Database, installId: string): ServerInstall {
  return installsRepository.updateServerInstall(db, installId, {
    status: 'provisioning',
    step: null,
    errorMessage: null,
    updatedAt: new Date(),
  })
}
