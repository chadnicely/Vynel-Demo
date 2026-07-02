#!/usr/bin/env node
// Executable entry for the `vynel` CLI. Builds the typed SDK client from
// env — lazily, so `--help` / `--version` need no running API — parses
// argv, and maps a failed command to a stderr message + exit code.
// (commander prints + exits for its own parse/help/version errors; this
// catch handles errors thrown by a command action, e.g. SdkError.)

import { createVynelClient, type VynelClient } from '@vynel/sdk'
import { buildProgram } from './index.js'
import { loadEnv } from './env.js'
import { formatError } from './output.js'

let client: VynelClient | undefined
function getClient(): VynelClient {
  client ??= createVynelClient({ baseUrl: loadEnv().VYNEL_API_URL })
  return client
}

buildProgram(getClient)
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    const { message, exitCode } = formatError(err)
    // eslint-disable-next-line no-console -- CLI error output channel
    console.error(message)
    // eslint-disable-next-line n/no-process-exit -- non-zero exit on command failure
    process.exit(exitCode)
  })
