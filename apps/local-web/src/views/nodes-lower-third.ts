// The lower third’s headline: a product name used as a HEADING, lifted out of
// the sentence so the card can show it big with the claim underneath
// (Chad, 2026-08-29).

const NAME_SEPARATORS = ["—", "–", "-", ":"];

/** The name only counts when it is used as a HEADING — "Letterman — the
 *  welcome email". "Letterman is live" is a sentence, and keeps its name. */
export function splitHeading(
  text: string,
  names: readonly string[],
): { name: string | null; body: string } {
  const body = text.trimStart();
  for (const name of names) {
    if (!body.toLowerCase().startsWith(name.toLowerCase())) continue;
    const rest = body.slice(name.length).trimStart();
    const separator = NAME_SEPARATORS.find((mark) => rest.startsWith(mark));
    if (separator === undefined) continue;
    return { name, body: rest.slice(separator.length).trimStart() };
  }
  return { name: null, body: text };
}
