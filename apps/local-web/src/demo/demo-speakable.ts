// WHAT THE VOICE IS HANDED (Chad, 2026-09-05: "ElevenLabs has a hard time
// calling our dollar amounts"). The screen wants "$1,896"; a TTS reading that
// aloud stumbles on the symbol — "dollar one eight nine six", or worse. So the
// display text and the spoken text part ways exactly here: every synthesis
// request converts money into the words a person would say, and nothing on
// screen changes at all.

/** "$1,896" -> "1,896 dollars"; "$1" -> "1 dollar". Applied only on the way
 *  INTO the synthesizer — bank keys and captions keep the written form. */
export function speakableText(text: string): string {
  return text.replace(
    /\$([\d,]+(?:\.\d+)?)/g,
    (_match, amount: string) =>
      `${amount} ${amount.replace(/[,.]/g, "") === "1" ? "dollar" : "dollars"}`,
  );
}
