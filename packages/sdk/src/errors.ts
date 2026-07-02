// Error thrown by the namespaced SDK surface (`client.knowledge.search()`
// etc.) on non-2xx responses. Carries the HTTP status + parsed error body
// + the underlying Response so consumers can inspect it.
//
// The path-keyed surface (`client.GET('/...')`) does NOT throw — it
// returns `{ data, error, response }` as openapi-fetch does by default.
// The namespaced wrappers explicitly throw to match the Stripe / Anthropic
// SDK ergonomic.
//
// The message is lifted from Vynel's error envelope (`{ code, message }`,
// emitted by the apps/api `onError` handler); the `code` stays available
// via `.body` for consumers that switch on it.
//
// Consumer pattern:
//   try {
//     const doc = await client.knowledge.getDocument(workspaceId, id)
//   } catch (err) {
//     if (err instanceof SdkError && err.status === 404) return null
//     throw err
//   }

export class SdkError extends Error {
  readonly status: number
  readonly body: unknown
  readonly response: Response

  constructor(response: Response, body: unknown) {
    const message =
      body &&
      typeof body === 'object' &&
      'message' in body &&
      typeof (body as { message: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `Request failed with status ${response.status}`
    super(message)
    this.name = 'SdkError'
    this.status = response.status
    this.body = body
    this.response = response
  }
}
