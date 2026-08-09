// The one home for turning a failed CLI invocation's stderr into the short
// detail a typed error carries: last three lines (the CLI prints its actual
// reason there, above is usage noise), hard-capped so a runaway dump never
// bloats an error message.

export function formatCliErrorDetail(stderr: string | undefined): string {
  return (stderr ?? '').trim().split('\n').slice(-3).join(' ').slice(0, 400)
}
