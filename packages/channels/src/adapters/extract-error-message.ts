// `extractErrorMessage(err)` — the adapter's error->message helper. Scrubs
// bot-token-shaped substrings BEFORE the message is logged or stored in
// `connectionStatusMessage` (the token must never leak — coding.md §1.1 +
// the "Vynel never logs credentials" guardrail). Used by the polling tick,
// the delivery tick, and credential verification.
//
// Spec: `docs/blueprints/channels/coding.md §1.1` + §6.

// Telegram bot tokens look like `<digits>:<35 url-safe chars>`. We scrub
// any token-shaped substring defensively (a thrown error from telegraf may
// echo the request URL, which embeds the token).
const TOKEN_SHAPED = /\d{6,}:[A-Za-z0-9_-]{30,}/g

export function extractErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown error'
  return raw.replace(TOKEN_SHAPED, '***')
}
