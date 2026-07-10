// argon2id via @node-rs/argon2 (prebuilt native, constant-time verify).
// Parameters follow the OWASP password-storage minimum (19 MiB memory,
// 2 iterations, parallelism 1) — raise memory before iterations if we ever
// strengthen.

import { hash, verify } from '@node-rs/argon2'
import type { Algorithm } from '@node-rs/argon2'

// `Algorithm` is an ambient const enum — its VALUES are unusable under
// verbatimModuleSyntax, so the argon2id member is spelled numerically
// (0 = argon2d, 1 = argon2i, 2 = argon2id).
const ARGON2ID = 2 as Algorithm

const ARGON2ID_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    // A malformed stored hash must read as "wrong password", never a 500 —
    // the caller answers with the same generic credentials error.
    return false
  }
}

let dummyHashPromise: Promise<string> | undefined

/**
 * A real argon2id hash to verify against when the ACCOUNT doesn't exist (or
 * has no password yet) — keeps sign-in timing flat so an attacker can't
 * probe which emails have accounts. Lazily computed once per process.
 */
export function getTimingDummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('vynel-timing-dummy-password')
  return dummyHashPromise
}
