// Postgres unique-violation (23505) detector. drizzle may wrap the driver
// error, so walk the cause chain. Shared by the provisioning flows that race
// on the accounts unique indexes (email / platformUserId).

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  while (current !== null && typeof current === 'object') {
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
