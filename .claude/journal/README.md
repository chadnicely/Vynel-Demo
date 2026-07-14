# Build journal

The "learn and re-correct" loop, on disk — one entry per module move.

**One file per day: `YYYY-MM-DD.md`.** Each day file opens with a `# YYYY-MM-DD` heading, then each
move that day is an `## ` section beneath it (its own sub-headings nested under that). Append the
day's next move as a new `## ` section; start a new dated file when the day rolls over.

Entry shape (terse and honest):

```
## <module> — what moved · what changed/improved (dedupe, rewire, tighten) ·
   what we learned · gate result (pnpm test / code-reviewer).
```

If a move revealed a wrong heading or a duplication worth extracting, that belongs here so the next
move starts smarter.
