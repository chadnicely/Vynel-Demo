// Strip markup a text-to-speech voice can't read so it isn't heard aloud (a TTS
// engine voices "**" as "asterisk asterisk", drones table pipes, spells URLs).
// Pure + streaming-safe: operates on one sentence/chunk at a time, so the voice
// relay strips as it speaks. It removes MARKUP only — it never truncates; the
// caller decides length (summarizeTurnForVoice caps a spoken summary; the live
// relay speaks every sentence). The spoken-style system prompt is the real fix
// (the model shouldn't emit markdown for a voice turn); this is the safety net.

export function stripSpokenMarkup(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // inline links / images → their text
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // reference-style links → their text
    .replace(/<[^>]+>/g, ' ') // autolinks + HTML tags
    .replace(/^[ \t]*(?:\d+\.|[-*+])[ \t]+/gm, '') // leading list markers (per line)
    .replace(/[|]/g, ' ') // table pipes
    .replace(/[*_#>~]/g, '') // emphasis / heading / quote / strike markers
    .replace(/\s+/g, ' ')
    .trim()
}
