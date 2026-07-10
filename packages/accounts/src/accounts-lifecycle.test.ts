// The full account lifecycle over a REAL Postgres dialect (PGlite): provision
// → invite link → set password → sign in → rotate → reuse detection → devices
// → disable → reset. One file because the flows only mean anything chained.

import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import { describe, it, expect, beforeAll } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { setAccountStatus, findAccountByEmail } from '@vynel/cloud-db/repositories/accounts'
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createProvisionedAccount,
  confirmSetPassword,
  signInWithPassword,
  rotateSession,
  listDevices,
  revokeDevice,
  signOut,
  requestPasswordReset,
  type AccessTokenIssuer,
  type AccessTokenVerifier,
  type AccountMailSender,
  type SetPasswordLinkMail,
  type SessionDeps,
} from './index.js'

const DEVICE = { deviceName: 'Chad-PC', devicePlatform: 'windows', appVersion: '0.1.0' }

let accessTokens: AccessTokenIssuer
let accessTokenVerifier: AccessTokenVerifier
let sessionDeps: SessionDeps

/** Captures sent mails and exposes the last link's raw token. */
function buildCapturingMail(): AccountMailSender & { sent: SetPasswordLinkMail[]; lastToken(): string } {
  const sent: SetPasswordLinkMail[] = []
  return {
    sent,
    async sendSetPasswordLink(mail) {
      sent.push(mail)
    },
    lastToken() {
      const link = sent[sent.length - 1]?.link ?? ''
      return new URL(link).searchParams.get('token') ?? ''
    },
  }
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  accessTokens = await createAccessTokenIssuer({
    privateKeyPem: await exportPKCS8(privateKey),
    ttlSeconds: 3600,
  })
  accessTokenVerifier = await createAccessTokenVerifier({
    publicKeyPem: await exportSPKI(publicKey),
  })
  sessionDeps = { accessTokens }
})

describe('the account lifecycle', () => {
  it('provisions, invites, sets a password, signs in, and verifies the access token', async () => {
    await withTestCloudDatabase(async (db) => {
      const mail = buildCapturingMail()
      const linkDeps = { mail, linkBaseUrl: 'https://hub.test' }

      const { accountId } = await createProvisionedAccount(
        db,
        { email: 'Chad@Example.com', displayName: 'Chad', platformUserId: 'plat-1' },
        linkDeps,
      )
      // Email lowercased at the repository boundary; invite mail sent.
      expect((await findAccountByEmail(db, 'chad@example.com'))?.id).toBe(accountId)
      expect(mail.sent[0]?.kind).toBe('invite')

      // Sign-in before a password exists fails with the generic error.
      await expect(
        signInWithPassword(db, { email: 'chad@example.com', password: 'pw', device: DEVICE }, sessionDeps),
      ).rejects.toMatchObject({ code: 'unauthorized' })

      await confirmSetPassword(db, { token: mail.lastToken(), newPassword: 'correct horse battery' }, {})
      // The link is single-use.
      await expect(
        confirmSetPassword(db, { token: mail.lastToken(), newPassword: 'again' }, {}),
      ).rejects.toMatchObject({ code: 'unauthorized' })

      const session = await signInWithPassword(
        db,
        { email: 'CHAD@example.com', password: 'correct horse battery', device: DEVICE },
        sessionDeps,
      )
      expect(session.refreshToken).toHaveLength(43)
      const claims = await accessTokenVerifier.verify(session.accessToken)
      expect(claims).toMatchObject({ accountId, email: 'chad@example.com', displayName: 'Chad' })

      // Wrong password → same generic error as unknown email.
      await expect(
        signInWithPassword(db, { email: 'chad@example.com', password: 'nope', device: DEVICE }, sessionDeps),
      ).rejects.toMatchObject({ message: 'Wrong email or password.' })
      await expect(
        signInWithPassword(db, { email: 'ghost@example.com', password: 'nope', device: DEVICE }, sessionDeps),
      ).rejects.toMatchObject({ message: 'Wrong email or password.' })
    })
  })

  it('rotates sessions, detects reuse, and lists/revokes devices', async () => {
    await withTestCloudDatabase(async (db) => {
      const mail = buildCapturingMail()
      const linkDeps = { mail, linkBaseUrl: 'https://hub.test' }
      await createProvisionedAccount(db, { email: 'a@b.c', displayName: 'A' }, linkDeps)
      await confirmSetPassword(db, { token: mail.lastToken(), newPassword: 'password-one' }, {})
      const first = await signInWithPassword(
        db,
        { email: 'a@b.c', password: 'password-one', device: DEVICE },
        sessionDeps,
      )

      // Rotation: old secret dies, new one works.
      const second = await rotateSession(db, { refreshToken: first.refreshToken }, sessionDeps)
      expect(second.refreshToken).not.toBe(first.refreshToken)

      // Replaying the SUPERSEDED secret = theft signal → the family dies,
      // including the freshly rotated secret.
      await expect(
        rotateSession(db, { refreshToken: first.refreshToken }, sessionDeps),
      ).rejects.toMatchObject({ code: 'unauthorized' })
      await expect(
        rotateSession(db, { refreshToken: second.refreshToken }, sessionDeps),
      ).rejects.toMatchObject({ code: 'unauthorized' })

      // Two fresh sign-ins = two devices; revoking one leaves the other.
      const laptop = await signInWithPassword(
        db,
        { email: 'a@b.c', password: 'password-one', device: { ...DEVICE, deviceName: 'Laptop' } },
        sessionDeps,
      )
      const desktop = await signInWithPassword(
        db,
        { email: 'a@b.c', password: 'password-one', device: { ...DEVICE, deviceName: 'Desktop' } },
        sessionDeps,
      )
      const devices = await listDevices(db, { accountId: laptop.accountId })
      expect(devices.map((d) => d.deviceName).sort()).toEqual(['Desktop', 'Laptop'])

      const laptopDevice = devices.find((d) => d.deviceName === 'Laptop')
      await revokeDevice(db, { accountId: laptop.accountId, deviceId: laptopDevice?.id ?? '' })
      await expect(
        rotateSession(db, { refreshToken: laptop.refreshToken }, sessionDeps),
      ).rejects.toMatchObject({ code: 'unauthorized' })
      const remaining = await listDevices(db, { accountId: laptop.accountId })
      expect(remaining.map((d) => d.deviceName)).toEqual(['Desktop'])

      // Sign-out kills the presenting device; unknown token is a no-op.
      await signOut(db, { refreshToken: desktop.refreshToken })
      await signOut(db, { refreshToken: desktop.refreshToken })
      expect(await listDevices(db, { accountId: laptop.accountId })).toEqual([])
    })
  })

  it('locks out a disabled account at rotation and ignores unknown reset emails', async () => {
    await withTestCloudDatabase(async (db) => {
      const mail = buildCapturingMail()
      const linkDeps = { mail, linkBaseUrl: 'https://hub.test' }
      const { accountId } = await createProvisionedAccount(
        db,
        { email: 'x@y.z', displayName: 'X' },
        linkDeps,
      )
      await confirmSetPassword(db, { token: mail.lastToken(), newPassword: 'a-password' }, {})
      const session = await signInWithPassword(
        db,
        { email: 'x@y.z', password: 'a-password', device: DEVICE },
        sessionDeps,
      )

      // The revocation moment: disable → the boot check (rotate) locks out.
      await setAccountStatus(db, { accountId, status: 'disabled' })
      await expect(
        rotateSession(db, { refreshToken: session.refreshToken }, sessionDeps),
      ).rejects.toMatchObject({ code: 'forbidden' })
      await expect(
        signInWithPassword(db, { email: 'x@y.z', password: 'a-password', device: DEVICE }, sessionDeps),
      ).rejects.toMatchObject({ code: 'forbidden' })

      // Unknown-email reset resolves silently (no enumeration); disabled
      // accounts get no link either.
      const sentBefore = mail.sent.length
      await requestPasswordReset(db, { email: 'ghost@y.z' }, linkDeps)
      await requestPasswordReset(db, { email: 'x@y.z' }, linkDeps)
      expect(mail.sent.length).toBe(sentBefore)
    })
  })

  it('kills every session when a password reset lands', async () => {
    await withTestCloudDatabase(async (db) => {
      const mail = buildCapturingMail()
      const linkDeps = { mail, linkBaseUrl: 'https://hub.test' }
      const { accountId } = await createProvisionedAccount(
        db,
        { email: 'r@s.t', displayName: 'R' },
        linkDeps,
      )
      await confirmSetPassword(db, { token: mail.lastToken(), newPassword: 'old-password' }, {})
      const session = await signInWithPassword(
        db,
        { email: 'r@s.t', password: 'old-password', device: DEVICE },
        sessionDeps,
      )

      await requestPasswordReset(db, { email: 'r@s.t' }, linkDeps)
      expect(mail.sent[mail.sent.length - 1]?.kind).toBe('password-reset')
      await confirmSetPassword(db, { token: mail.lastToken(), newPassword: 'new-password' }, {})

      await expect(
        rotateSession(db, { refreshToken: session.refreshToken }, sessionDeps),
      ).rejects.toMatchObject({ code: 'unauthorized' })
      expect(await listDevices(db, { accountId })).toEqual([])
      await expect(
        signInWithPassword(db, { email: 'r@s.t', password: 'new-password', device: DEVICE }, sessionDeps),
      ).resolves.toMatchObject({ accountId })
    })
  })
})
