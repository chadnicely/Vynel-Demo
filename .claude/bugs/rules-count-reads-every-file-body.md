# The menu's `Rules N` reads every rule file's full body to produce an integer

**Status:** open
**Kind:** accepted-tradeoff
**Area:** `packages/skills` (rules) → `apps/local-api/src/routes/section-counts`
**Opened:** 2026-08-15 (raised by the section-counts reviewer gate)

## What happens

`count-sections.ts` counts rules by calling the section's own list function and taking its
length. `listAllRuleFilesForScope`
(`packages/skills/src/rules/list-all-rule-files-for-scope.ts:41-63`) does, per `.md` file:

```
readFileSync(full content)      ← the whole body
parseRuleFileMarker(content)
extractTitle(content)           ← regex
push { ruleId, fileName, title, content, marketplace }
```

…and the caller keeps only `.length`. Measured on the dev machine: **5 files, 11.0 KB read per
count call** (8.6 KB of it one file), ten parses, five objects holding whole file bodies —
all discarded.

It runs on the menu's path: per scope, `staleTime: 30_000`, and now after **every** successful
mutation (`plugins/vue-query.ts` refreshes the counts centrally).

## Why we do it the expensive way

The arc's one rule: **every count calls the same core read the section's list route calls.**
That is what makes the number and the rows unable to disagree — and the one count that broke
the rule is the one that drifted (see `sessions-library-truncates-at-50.md` and commit
`c5ce578`).

The cheap counter is not equivalent. Line 46-48 is `catch { continue }`: a file that cannot be
READ is silently absent from the list, but `readdir().filter(f => f.endsWith('.md')).length`
would count it. So the two answers differ exactly where the filesystem misbehaves.

## The decision, if we ever take it

Not "make it faster" — **should an unreadable rule file count?**

- *Yes* → a cheap `countRuleFilesForScope` (readdir + extension filter) is correct and ~100×
  cheaper. Accept that the count can exceed the list by the number of unreadable files.
- *No* → matching the list exactly means attempting the read, which IS the expensive part.
  Little left to win; keep what we have.

Either way the fix belongs in `packages/skills/src/rules/` beside the list function, sharing
its skip logic — never a predicate re-derived in the route.

## Recommendation

Leave it. Local disk, kilobytes, and correctness-by-construction is the better trade at this
size. Revisit if a rules folder reaches ~100 files or the menu measurably lags — and decide the
unreadable-file question deliberately when you do.
