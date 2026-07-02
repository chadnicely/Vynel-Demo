// stdout/stderr helpers for the CLI. `printResult` pretty-prints a
// successful (typed) API result as JSON. `formatError` maps any thrown
// value to a stderr message + process exit code — kept PURE (returns
// rather than exits) so it's unit-testable without spawning a process.

import { SdkError } from '@vynel/sdk'

export function printResult(payload: unknown): void {
  // eslint-disable-next-line no-console -- stdout IS the CLI's output channel
  console.log(JSON.stringify(payload, null, 2))
}

export function formatError(err: unknown): { message: string; exitCode: number } {
  if (err instanceof SdkError) {
    return { message: `Error ${err.status}: ${err.message}`, exitCode: 1 }
  }
  if (err instanceof Error) {
    return { message: `Error: ${err.message}`, exitCode: 1 }
  }
  return { message: `Error: ${String(err)}`, exitCode: 1 }
}
