// One home for turning a failed provider HTTP exchange into a message
// that is safe to show and log: status-first, body excerpt bounded, and
// NEVER the request (the request carries the API key header).

export const PROVIDER_FAULT_EXCERPT_LIMIT = 200

export async function describeProviderFault(response: Response): Promise<string> {
  let excerpt = ''
  try {
    const body = await response.text()
    excerpt = body.slice(0, PROVIDER_FAULT_EXCERPT_LIMIT).trim()
  } catch {
    // An unreadable body leaves the status alone — the status is the fact.
  }
  return excerpt.length > 0 ? `HTTP ${response.status}: ${excerpt}` : `HTTP ${response.status}`
}

export function describeNetworkFault(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `network failure: ${message}`
}
