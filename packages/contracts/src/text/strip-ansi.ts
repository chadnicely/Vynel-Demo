// Terminal escape sequences carry no meaning once the text leaves the terminal:
// a captured process tail travels into outbox payloads, monitor wake messages
// and MCP tool output, and a provider decision reason is rendered in the thread —
// raw ESC[36m colour runs read as garbage in all of them. The SDK says so
// outright about its own reasons ("may carry ANSI escapes; sanitize before
// rendering").
//
// It lives in the shared layer because the strippers are LEAVES (@vynel/apps,
// @vynel/processes, @vynel/providers) that may not import each other — three
// copies of one regex was the alternative.

// CSI sequences, plus any stray lone ESC.
// eslint-disable-next-line no-control-regex -- the escape byte IS what is matched
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '')
}
