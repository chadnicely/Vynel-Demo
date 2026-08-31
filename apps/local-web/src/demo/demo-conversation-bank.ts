// THE WRITTEN BANK (Chad, 2026-08-30: "we're going to do like 100 videos so
// they need to be unique and magical" — "as real as it possibly can be").
//
// These are WRITTEN, not generated. A template with the product names swapped
// is the same sentence a hundred times in different hats, and he heard it
// immediately. Every set below is its own small piece of dialogue: a different
// mood, a different way of getting to the same beat.
//
// Not generated at film time either. Writing a line live costs five to ten
// seconds of a man standing in front of a lens saying nothing — the whole
// reason this film is pre-recorded. Written once, banked, spoken instantly.
//
// THE FOUR BEATS, always the same shape because his side never changes:
//
//   he: "What's up Pacino"      → OPENING   (status + the offer)
//   he: "Yeah, go on"           → HANDOVER  (into the numbers)
//   he: "How's dev looking?"    → SOFTWARE  (into the products)
//   he: "Thanks Pacino"         → CLOSING   (then black)
//
// `{product}` and `{other}` are filled with the take's own software, so a set
// is about the take it is filming. Sets with no slot suit any take.

/** One take's worth of dialogue. */
export interface WrittenConversation {
  readonly opening: string;
  readonly handover: string;
  readonly software: string;
  readonly closing: string;
  /** Only for takes that actually report money — "sales are ahead" must never
   *  open a take with no sales in it. */
  readonly needsMoney?: boolean;
}

export const WRITTEN_CONVERSATIONS: readonly WrittenConversation[] = [
  {
    opening: "Evening. Everything's green — want your updates?",
    handover: "Right, here's how the day went.",
    software: "Good one today. {product}'s MCP finally went in. Let me pull the log.",
    closing: "No problem, boss.",
  },
  {
    opening: "Hey boss. Quiet night, nothing needs you. Shall I run the numbers?",
    handover: "Course. Here's where we landed.",
    software:
      "Busy day. Most of the hours went into {product} — here's what shipped.",
    closing: "Have a good one, Chad.",
  },
  {
    opening: "Perfect timing — sales are already ahead. Want the rundown?",
    handover: "Sure thing. Here's your day.",
    software:
      "Where do I start. {product} shipped, {other}'s right behind it. Here's the log.",
    closing: "I'll keep you updated.",
    needsMoney: true,
  },
  {
    opening: "Morning. All on track, nothing on fire. Ready for your update?",
    handover: "Absolutely. This is what came in.",
    software:
      "The Titanium Suite's a bit stronger tonight than it was this morning. Let me show you.",
    closing: "Any time. I'll keep watch.",
  },
  {
    opening: "Good to see you. The money's moving nicely — want me to run through it?",
    handover: "Of course. Here's the day.",
    software: "Solid day. We got {product} over the line. Here's the rundown.",
    closing: "Consider it handled.",
    needsMoney: true,
  },
  {
    opening: "Hey. Everything's behaving itself — shall I give you the update?",
    handover: "Yep. These are today's numbers.",
    software:
      "MCPs were the story today, {product} especially. Let me take you through it.",
    closing: "Leave it with me.",
  },
  {
    opening: "Right on time. All quiet out there — want your numbers?",
    handover: "Sure. Here's what happened.",
    software:
      "Everything moved a little; {product} moved a lot. Here's the log.",
    closing: "Go enjoy your night, boss.",
  },
  {
    opening: "Evening boss. We're up on the day — want me to take you through it?",
    handover: "Right you are. Here's the day.",
    software:
      "Really good one. {product} and {other} both landed. Let me pull the dev log.",
    closing: "Nice one. Talk soon.",
    needsMoney: true,
  },
  {
    opening: "Hey. Nothing needs a decision tonight — shall I run the update?",
    handover: "Course. Here's where we finished.",
    software: "{product} finally clicked into place today. Here's what shipped.",
    closing: "I'll flag anything that changes.",
  },
  {
    opening: "Morning. The whole fleet's steady. Ready for the numbers?",
    handover: "Sure thing. Here's your day.",
    software:
      "Quiet on most of it, but {product} had a proper day. Let me get the log.",
    closing: "All yours, Chad.",
  },
  {
    opening: "Good evening. Takings are looking healthy — want the update?",
    handover: "Absolutely. Here's how it went.",
    software:
      "The Suite picked up more MCPs today. {product} led it. Here's the rundown.",
    closing: "Sleep well — I'll be watching it.",
    needsMoney: true,
  },
  {
    opening: "Hey boss. It's all running clean — shall I give you the numbers?",
    handover: "Yes. Here's the day.",
    software: "Two of them moved today. Let me walk you through it.",
    closing: "Any time at all.",
  },
  {
    opening: "Evening. Revenue's running ahead of yesterday — want your updates?",
    handover: "Course. This is what came in.",
    software:
      "Real progress on {product} today. Here's what the log says.",
    closing: "You got it, boss.",
    needsMoney: true,
  },
  {
    opening: "Hey. No fires anywhere — ready for your rundown?",
    handover: "Sure. Here's where we landed.",
    software:
      "Good news — the MCP work landed on {product}. Let me pull the log.",
    closing: "I'll be here if anything comes up.",
  },
  {
    opening: "Right on time, boss. Everything's green. Want the numbers?",
    handover: "Yep. Here's your day.",
    software:
      "Productive one. {product} took most of it, {other} the rest. Here's the log.",
    closing: "No trouble at all.",
  },
  {
    opening: "Morning. Numbers are up on yesterday — shall I run them?",
    handover: "Of course. This is today.",
    software: "Big day for {product}. Let me take you through what shipped.",
    closing: "Done. Have a good one.",
    needsMoney: true,
  },
  {
    opening: "Evening. All on track and nothing waiting on you. Want the update?",
    handover: "Sure thing. Here's the day.",
    software:
      "The Titanium Suite's coming together. {product} and {other} both landed.",
    closing: "I'll keep the lights on.",
  },
  {
    opening: "Hey boss. Everything behaved today — ready for your numbers?",
    handover: "Right. Here's what came through.",
    software:
      "Where the hours went was {product}. Here's what came out of it.",
    closing: "Catch you later, Chad.",
  },
  {
    opening: "Good to see you. Sales are ahead — want me to run the update?",
    handover: "Course. Here's your day.",
    software:
      "Really strong day. {product}'s MCP is in and working. Here's the log.",
    closing: "Say the word if you need more.",
    needsMoney: true,
  },
  {
    opening: "Evening. Quiet one, all green. Shall I give you the rundown?",
    handover: "Yes. Here's how we finished.",
    software:
      "Everyone was busy. {product} came out furthest ahead. Here's the log.",
    closing: "Easy. I've got it from here.",
  },
  {
    opening: "Hey. Nothing's gone wrong all night — want your update?",
    handover: "Sure. This is where we are.",
    software:
      "Mostly MCP work today, mostly on {product}. Let me show you.",
    closing: "Whenever you need me, Chad.",
  },
  {
    opening: "Morning boss. Money's moving — ready for the numbers?",
    handover: "Absolutely. Here's the day.",
    software:
      "Cracking day. {product} shipped and {other} isn't far off. Here's the log.",
    closing: "Done and dusted. Night, boss.",
    needsMoney: true,
  },
  {
    opening: "Evening. Everything's steady out there. Want me to run through it?",
    handover: "Course. These are today's numbers.",
    software:
      "{product}'s in good shape now, and so is {other}. Here's what shipped.",
    closing: "Sound. I'll keep it moving.",
  },
  {
    opening: "Hey boss. All clean, nothing needs you — shall I run the update?",
    handover: "Yep. Here's your day.",
    software:
      "The MCPs went in on {product} today. That's the headline. Here's the rest.",
    closing: "No problem. Have a good night.",
  },
];
