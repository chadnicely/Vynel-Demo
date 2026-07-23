// Zoom REST surface the adapter talks to: the client_credentials token
// grant + the Chatbot Messages API (send / edit). Pure functions over an
// injectable fetch (the network boundary the tests stub — the telegraf
// precedent, without the SDK). Credentials never enter thrown messages;
// callers see status + Zoom's error body only.
//
// Spec: `docs/module-notes/channels-zoom.md` +
// https://developers.zoom.us/docs/api/chatbot/.

export type FetchFn = typeof globalThis.fetch

export interface ZoomAccessToken {
  accessToken: string
  /** Epoch ms when the token stops being trusted (issued lifetime ~1h;
   *  callers refresh ahead of this). */
  expiresAtMs: number
  /** The account the app belongs to, decoded from the token's `aid` JWT
   *  claim — Zoom's console barely surfaces the Account ID, so the adapter
   *  detects it instead of making the user hunt for it. Null when the
   *  token isn't a decodable JWT (fall back to a user-supplied value). */
  accountId: string | null
}

// Refresh 5 minutes before the announced expiry — the OpenClaw-precedent
// margin, wide enough that an in-flight send never crosses the boundary.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000

export async function fetchZoomAccessToken(
  input: { clientId: string; clientSecret: string },
  fetchFn: FetchFn,
): Promise<ZoomAccessToken> {
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')
  const response = await fetchFn('https://zoom.us/oauth/token?grant_type=client_credentials', {
    method: 'POST',
    headers: { authorization: `Basic ${basic}` },
  })
  if (!response.ok) {
    throw new Error(`zoom token grant failed: ${response.status} ${await safeBodyText(response)}`)
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new Error('zoom token grant failed: response carried no access_token')
  }
  const lifetimeMs = (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000
  return {
    accessToken: body.access_token,
    expiresAtMs: Date.now() + Math.max(lifetimeMs - TOKEN_REFRESH_MARGIN_MS, 60_000),
    accountId: decodeTokenAccountId(body.access_token),
  }
}

// Zoom access tokens are JWTs; the payload's `aid` claim is the account id.
// Best-effort by design — any malformed shape reads as null, never a throw.
function decodeTokenAccountId(accessToken: string): string | null {
  const segments = accessToken.split('.')
  if (segments.length < 2) return null
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    return typeof payload.aid === 'string' && payload.aid !== '' ? payload.aid : null
  } catch {
    return null
  }
}

export interface ZoomChatbotMessageInput {
  accessToken: string
  robotJid: string
  accountId: string
  toJid: string
  text: string
  isMarkdown: boolean
  /** Thread onto this message (group rooms). */
  replyToMessageId?: string
}

export async function sendZoomChatbotMessage(
  input: ZoomChatbotMessageInput,
  fetchFn: FetchFn,
): Promise<{ messageId: string }> {
  const response = await fetchFn('https://api.zoom.us/v2/im/chat/messages', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      robot_jid: input.robotJid,
      account_id: input.accountId,
      to_jid: input.toJid,
      ...(input.isMarkdown ? { is_markdown_support: true } : {}),
      ...(input.replyToMessageId !== undefined ? { reply_to: input.replyToMessageId } : {}),
      content: { body: [{ type: 'message', text: input.text }] },
    }),
  })
  if (!response.ok) {
    throw new Error(`zoom send failed: ${response.status} ${await safeBodyText(response)}`)
  }
  const body = (await response.json()) as { message_id?: string }
  return { messageId: body.message_id ?? '' }
}

export async function editZoomChatbotMessage(
  input: ZoomChatbotMessageInput & { messageId: string },
  fetchFn: FetchFn,
): Promise<void> {
  const response = await fetchFn(
    `https://api.zoom.us/v2/im/chat/messages/${encodeURIComponent(input.messageId)}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        robot_jid: input.robotJid,
        account_id: input.accountId,
        to_jid: input.toJid,
        ...(input.isMarkdown ? { is_markdown_support: true } : {}),
        content: { body: [{ type: 'message', text: input.text }] },
      }),
    },
  )
  if (!response.ok) {
    throw new Error(`zoom edit failed: ${response.status} ${await safeBodyText(response)}`)
  }
}

async function safeBodyText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300)
  } catch {
    return ''
  }
}
