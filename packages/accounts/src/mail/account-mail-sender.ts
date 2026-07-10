// The mail seam. The hub needs exactly one email today: "set your password"
// (invite after platform provisioning, or a reset). A real provider
// (Resend/Postmark) implements this at deploy time; the logging impl keeps
// dev + tests runnable without one.

import type { StructuralLogger } from '@vynel/logger'

export interface SetPasswordLinkMail {
  readonly email: string
  readonly displayName: string
  readonly kind: 'invite' | 'password-reset'
  readonly link: string
  readonly expiresAt: Date
}

export interface AccountMailSender {
  sendSetPasswordLink(mail: SetPasswordLinkMail): Promise<void>
}

export function createLoggingAccountMailSender(logger: StructuralLogger): AccountMailSender {
  return {
    async sendSetPasswordLink(mail) {
      // DEV-ONLY sender: the link (a secret) is deliberately logged because
      // no mail provider is configured — it is the only way the flow is
      // usable. The production sender replaces this whole impl; never wire
      // this one where real users' links would land in logs.
      logger.warn(
        { email: mail.email, kind: mail.kind, link: mail.link, expiresAt: mail.expiresAt },
        'mail sender not configured — set-password link logged (dev only)',
      )
    },
  }
}
