// THE WRITTEN BANK (Chad, 2026-08-30: "100 videos... unique and magical" —
// "as real as it possibly can be" — 2026-08-31: "all the lines need to be
// unique" and "I wish there was more personality").
//
// These are WRITTEN, not generated. A template with the product names swapped
// is the same sentence a hundred times in different hats, and he heard it
// immediately. Every set below is its own small scene: a different mood, a
// different way through the same five beats.
//
// PERSONALITY IS THE POINT. An assistant that only ever reports is furniture.
// This one has opinions about the day — it is pleased, it is unbothered, it
// notices when something took longer than it should have. It never grovels
// and it never gushes; it talks the way somebody does who has had the place
// running smoothly and knows it.
//
// THE FIVE BEATS. His side never changes, so neither does the shape:
//
//   he: "What's up Pacino"    → OPENING   status, and the offer
//   he: "Yeah, go on"         → HANDOVER  into the numbers
//   he: "How's dev looking?"  → SOFTWARE  into the products
//        (the products play)  → WRAP      the sign-off ON the board
//   he: "Thanks Pacino"       → CLOSING   then black
//
// WRAP was the last thing to repeat. It came from a separate little pool of
// closing lines, so every take in a reel ended on the same sentence however
// different the rest of it was ("it always says the same end" — 2026-08-31).
// It belongs to the take now, like everything else it says.
//
// `{product}` and `{other}` are filled with the take's own software.

/** One take's worth of dialogue. */
export interface WrittenConversation {
  readonly opening: string;
  readonly handover: string;
  readonly software: string;
  /** Said over the lit board, after the last product. */
  readonly wrap: string;
  readonly closing: string;
  /** Only for takes that actually report money — "sales are ahead" must never
   *  open a take with no sales in it. */
  readonly needsMoney?: boolean;
}

export const WRITTEN_CONVERSATIONS: readonly WrittenConversation[] = [
  {
    opening: "Evening. Everything's green — want your updates?",
    handover: "Right, here's how the day went.",
    software: "Good one today. The MCP work on {product} finally went in. Let me pull the log.",
    wrap: "And that's the lot. Quiet day, in the best way.",
    closing: "No problem, boss.",
  },
  {
    opening: "Hey boss. Quiet night, nothing needs you. Shall I run the numbers?",
    handover: "Course. Here's where we landed.",
    software: "Busy day. Most of the hours went into {product} — here's what shipped.",
    wrap: "All of that ran itself while you were off doing something better.",
    closing: "Have a good one, Chad.",
  },
  {
    opening: "Perfect timing — sales are already ahead. Want the rundown?",
    handover: "Sure thing. Here's your day.",
    software: "Where do I start. {product} shipped, {other} right behind it. Here's the log.",
    wrap: "Good day, that. The kind you'd want on video.",
    closing: "I'll keep you updated.",
    needsMoney: true,
  },
  {
    opening: "Morning. All on track, nothing on fire. Ready for your update?",
    handover: "Absolutely. This is what came in.",
    software: "The Titanium Suite's a bit stronger tonight than it was this morning. Let me show you.",
    wrap: "Nothing dramatic. Just everything doing what it should.",
    closing: "Any time. I'll keep watch.",
  },
  {
    opening: "Good to see you. The money's moving nicely — want me to run through it?",
    handover: "Of course. Here's the day.",
    software: "Solid day. We got {product} over the line. Here's the rundown.",
    wrap: "That's the board. Everything on it earned its place today.",
    closing: "Consider it handled.",
    needsMoney: true,
  },
  {
    opening: "Hey. Everything's behaving itself — shall I give you the update?",
    handover: "Yep. These are today's numbers.",
    software: "MCPs were the story today, {product} especially. Let me take you through it.",
    wrap: "And that's your evening. Nothing waiting, nothing broken.",
    closing: "Leave it with me.",
  },
  {
    opening: "Right on time. All quiet out there — want your numbers?",
    handover: "Sure. Here's what happened.",
    software: "Everything moved a little; {product} moved a lot. Here's the log.",
    wrap: "That's everything. {product} did the heavy lifting today.",
    closing: "Go enjoy your night, boss.",
  },
  {
    opening: "Evening boss. We're up on the day — want me to take you through it?",
    handover: "Right you are. Here's the day.",
    software: "Really good one. {product} and {other} both landed. Let me pull the dev log.",
    wrap: "Two shipped, nothing stuck. I'll take that.",
    closing: "Nice one. Talk soon.",
    needsMoney: true,
  },
  {
    opening: "Hey. Nothing needs a decision tonight — shall I run the update?",
    handover: "Course. Here's where we finished.",
    software: "{product} finally clicked into place today. Here's what shipped.",
    wrap: "That one's been dragging for a while. Good to see it done.",
    closing: "I'll flag anything that changes.",
  },
  {
    opening: "Morning. The whole fleet's steady. Ready for the numbers?",
    handover: "Sure thing. Here's your day.",
    software: "Quiet on most of it, but {product} had a proper day. Let me get the log.",
    wrap: "So — one big mover and the rest ticking along. No complaints.",
    closing: "All yours, Chad.",
  },
  {
    opening: "Good evening. Takings are looking healthy — want the update?",
    handover: "Absolutely. Here's how it went.",
    software: "The Suite picked up more MCPs today. {product} led it. Here's the rundown.",
    wrap: "Every one of those is a thing you no longer have to do yourself.",
    closing: "Sleep well — I'll be watching it.",
    needsMoney: true,
  },
  {
    opening: "Hey boss. It's all running clean — shall I give you the numbers?",
    handover: "Yes. Here's the day.",
    software: "Two of them moved today. Let me walk you through it.",
    wrap: "That's your board. Short list, all of it finished.",
    closing: "Any time at all.",
  },
  {
    opening: "Evening. Revenue's running ahead of yesterday — want your updates?",
    handover: "Course. This is what came in.",
    software: "Real progress on {product} today. Here's what the log says.",
    wrap: "Better day than yesterday, and yesterday was decent.",
    closing: "You got it, boss.",
    needsMoney: true,
  },
  {
    opening: "Hey. No fires anywhere — ready for your rundown?",
    handover: "Sure. Here's where we landed.",
    software: "Good news — the MCP work landed on {product}. Let me pull the log.",
    wrap: "And nothing on that board is waiting on you. That's the whole idea.",
    closing: "I'll be here if anything comes up.",
  },
  {
    opening: "Right on time, boss. Everything's green. Want the numbers?",
    handover: "Yep. Here's your day.",
    software: "Productive one. {product} took most of it, {other} the rest. Here's the log.",
    wrap: "That's the fleet. Busy, and none of it needed you.",
    closing: "No trouble at all.",
  },
  {
    opening: "Morning. Numbers are up on yesterday — shall I run them?",
    handover: "Of course. This is today.",
    software: "Big day for {product}. Let me take you through what shipped.",
    wrap: "Not a bad morning's work, and it's not even lunchtime.",
    closing: "Done. Have a good one.",
    needsMoney: true,
  },
  {
    opening: "Evening. All on track and nothing waiting on you. Want the update?",
    handover: "Sure thing. Here's the day.",
    software: "The Titanium Suite's coming together. {product} and {other} both landed.",
    wrap: "It's starting to look like one thing rather than several. That's the goal.",
    closing: "I'll keep the lights on.",
  },
  {
    opening: "Hey boss. Everything behaved today — ready for your numbers?",
    handover: "Right. Here's what came through.",
    software: "Where the hours went was {product}. Here's what came out of it.",
    wrap: "One thing, done properly. Better than five half-done.",
    closing: "Catch you later, Chad.",
  },
  {
    opening: "Good to see you. Sales are ahead — want me to run the update?",
    handover: "Course. Here's your day.",
    software: "Really strong day. The MCP on {product} is in and working. Here's the log.",
    wrap: "Money up, code shipped. Days like this are why we bother.",
    closing: "Say the word if you need more.",
    needsMoney: true,
  },
  {
    opening: "Evening. Quiet one, all green. Shall I give you the rundown?",
    handover: "Yes. Here's how we finished.",
    software: "Everyone was busy. {product} came out furthest ahead. Here's the log.",
    wrap: "That's it. Everything moved, nothing broke.",
    closing: "Easy. I've got it from here.",
  },
  {
    opening: "Hey. Nothing's gone wrong all night — want your update?",
    handover: "Sure. This is where we are.",
    software: "Mostly MCP work today, mostly on {product}. Let me show you.",
    wrap: "So that's your board, and it looked after itself.",
    closing: "Whenever you need me, Chad.",
  },
  {
    opening: "Morning boss. Money's moving — ready for the numbers?",
    handover: "Absolutely. Here's the day.",
    software: "Cracking day. {product} shipped and {other} isn't far off. Here's the log.",
    wrap: "One over the line, one nearly there. Tomorrow looks good.",
    closing: "Done and dusted. Night, boss.",
    needsMoney: true,
  },
  {
    opening: "Evening. Everything's steady out there. Want me to run through it?",
    handover: "Course. These are today's numbers.",
    software: "{product} is in good shape now, and so is {other}. Here's what shipped.",
    wrap: "Two off the list. The board's looking tidier than it was.",
    closing: "Sound. I'll keep it moving.",
  },
  {
    opening: "Hey boss. All clean, nothing needs you — shall I run the update?",
    handover: "Yep. Here's your day.",
    software: "The MCPs went in on {product} today. That's the headline. Here's the rest.",
    wrap: "And that's the day. It ran while you were somewhere else, which is the point.",
    closing: "No problem. Have a good night.",
  },

  // ── The personal sixteen (Chad, 2026-09-01: "more personal and real").
  // These talk TO him — his evening, his coffee, the video he is filming, the
  // fact he was away — not at a camera. Still day-scoped, still never gushing.
  {
    opening: "There he is. All quiet since you stepped out — want the numbers?",
    handover: "Course. Sit down, here's your day.",
    software: "You'll like this one. The MCP work on {product} went in clean. Here's the log.",
    wrap: "Honestly? Smooth day. You picked a good one to be out.",
    closing: "Go on, get your evening back.",
  },
  {
    opening: "Evening, Chad. I was about to send you the summary — want it out loud instead?",
    handover: "Even better. Here's the day.",
    software: "Dev didn't waste the daylight. {product} mostly — let me pull it up.",
    wrap: "That's the board. I'd call that a day well spent.",
    closing: "Night, boss. It's in good hands.",
  },
  {
    opening: "Hey you. Everything held together while you were gone — updates?",
    handover: "Yep. Here's what the day did.",
    software: "Good question. {product} answered it — here's what shipped.",
    wrap: "All of that, and you didn't have to touch any of it.",
    closing: "That's what I'm here for.",
  },
  {
    opening: "Boss. Sales moved while you were at dinner — want to hear it?",
    handover: "Thought so. Here you go.",
    software: "Dev's been heads-down. {product} came out the other side — here's the log.",
    wrap: "Money in, code out. That's the machine working.",
    closing: "Enjoy the rest of your night, Chad.",
    needsMoney: true,
  },
  {
    opening: "Look who's back. Nothing broke, nobody's waiting — numbers?",
    handover: "Here's the shape of it.",
    software: "The Suite grew a little today. {product} did the growing. Let me show you.",
    wrap: "Tidy day. The kind that doesn't make headlines and pays for everything.",
    closing: "See you tomorrow, boss.",
  },
  {
    opening: "Evening. I kept your seat warm and the fleet green — want your update?",
    handover: "Right then. Today, in order.",
    software: "Glad you asked. {product} and {other} both put in a shift. Here's the log.",
    wrap: "Not one thing up there needs a decision from you. By design.",
    closing: "I've got the night watch, Chad.",
  },
  {
    opening: "There you are. The numbers came in better than I promised — want them?",
    handover: "With pleasure. Here's the day.",
    software: "Dev owes you nothing today — {product} shipped. Here's what it looks like.",
    wrap: "I said this morning it'd be a good day. I hate being wrong, so it was.",
    closing: "Always a pleasure, boss.",
    needsMoney: true,
  },
  {
    opening: "Hey Chad. Finish your coffee first, or want the numbers now?",
    handover: "Now it is. Here's the day so far.",
    software: "Dev's ahead of you — {product}'s update landed before breakfast. Here's the log.",
    wrap: "And all that before most people answered their first email.",
    closing: "Back to it. Shout when you need me.",
  },
  {
    opening: "Evening boss. I counted twice because you'd ask — want the numbers?",
    handover: "Counted twice, same answer. Here.",
    software: "Dev kept their word today. {product} is in. Let me pull the log.",
    wrap: "Everything I told you this morning came true. Rare and pleasant.",
    closing: "Good night, Chad. I mean it — actually rest.",
  },
  {
    opening: "You picked a good moment. The day just wrapped — want the rundown?",
    handover: "Fresh off the press. Here.",
    software: "Ah, the good part. {product} — the MCP's live. Let me walk you through.",
    wrap: "That's a wrap on today. Tomorrow's already queued up.",
    closing: "Go be a person for a while, boss.",
  },
  {
    opening: "Hey. Quick heads up — nothing needs you, but the numbers are worth hearing.",
    handover: "Told you. Here's the day.",
    software: "Dev quietly had one of their better days. {product}, mostly. Here's the log.",
    wrap: "The quiet ones are the good ones. This was a quiet one.",
    closing: "I'll hold the fort, Chad.",
    needsMoney: true,
  },
  {
    opening: "Boss. Whatever you did today, do it again — the numbers liked it.",
    handover: "See for yourself. Here's the day.",
    software: "Dev matched it. {product} over the line, {other} close. Here's the log.",
    wrap: "Days like this make the hard weeks worth it.",
    closing: "Rest up. Tomorrow we do it again.",
    needsMoney: true,
  },
  {
    opening: "Evening. You missed nothing and gained plenty — want the details?",
    handover: "Right. The day, start to finish.",
    software: "Funny you ask — I just filed {product}'s update. Here's what went in.",
    wrap: "So no, you didn't need to check your phone at dinner.",
    closing: "Off you go, boss. I've got this.",
  },
  {
    opening: "There he is. Fleet's green, coffee's on you — want your numbers?",
    handover: "Deal. Here's the day.",
    software: "Dev's answer is {product}. Shipped, tested, in. Here's the log.",
    wrap: "Every light on that board is green because somebody built it right. That's you.",
    closing: "Flattery's free, boss. The numbers weren't. Night.",
  },
  {
    opening: "Hey Chad — good timing, I just finished the evening pass. Want it?",
    handover: "All yours. Here's how it went.",
    software: "The Titanium Suite got heavier today, the good kind of heavy. {product} led. Here's the log.",
    wrap: "One more day where the Suite did the work and you got the credit.",
    closing: "As it should be. Night, boss.",
  },
  {
    opening: "Evening. Short version: everything worked. Want the long version?",
    handover: "The long version, then. Here.",
    software: "Longer story on dev — worth it though. {product} finally behaved. Here's the log.",
    wrap: "The long version and the short version agree: good day.",
    closing: "Any time you like, Chad.",
  },
];
