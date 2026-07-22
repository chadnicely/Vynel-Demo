// One home for the calendar-day (`YYYY-MM-DD`) flag both date-wise command
// groups share: parse/validate a --date style argument, and the local "today"
// default (the CLI is a user surface — the user's clock owns "today", never
// the server's).

import { InvalidArgumentError } from 'commander'

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function toDayKey(value: string): string {
  if (DAY_KEY_PATTERN.test(value)) return value
  throw new InvalidArgumentError(`expected a YYYY-MM-DD date, got "${value}".`)
}

export function localDayKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
