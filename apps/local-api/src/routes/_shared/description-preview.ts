// The ONE home for the big-description preview rule shared by the phases and
// features LIST serializers: their `description` bodies run up to 50k chars,
// so list responses (and the MCP list tools built from them) carry a bounded
// preview; the single-row GET is where the full text lives.

export const DESCRIPTION_PREVIEW_MAX_LENGTH = 240

export function buildDescriptionPreview(description: string): string {
  if (description.length <= DESCRIPTION_PREVIEW_MAX_LENGTH) return description
  return `${description.slice(0, DESCRIPTION_PREVIEW_MAX_LENGTH)}…`
}
