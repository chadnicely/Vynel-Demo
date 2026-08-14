# Known bugs + accepted trade-offs

Things we know are wrong (or knowingly imperfect) and have NOT fixed. One file per issue,
`<slug>.md`, so it can be linked from a commit, a module note, or `STATE.md`.

This is a punch-list, not a backlog groomed by anyone — an entry earns its place by being
**real and reproducible**, not by being a nice-to-have. If it's a feature we haven't built,
it belongs in the module notes' deferral list, not here.

## The header every entry carries

```
**Status:** <open | fixed (sha) | wontfix>
**Kind:**   <defect | latent-defect | accepted-tradeoff | hazard>
**Area:**   <package or app>
**Opened:** <YYYY-MM-DD>
```

The open list is:

```sh
grep -l 'Status:\*\* open' .claude/bugs/*.md
```

The status lives in the file, never in a second index that can drift. (The angle brackets above
keep this README out of its own results — don't drop them.)

## Kinds, honestly

- **defect** — user-visible wrong behaviour today.
- **latent-defect** — wrong behaviour that needs a threshold to surface (scale, a rare state).
  Real, just not hit yet.
- **accepted-tradeoff** — we chose this knowingly and would choose it again; recorded so the
  next reader doesn't "fix" it without knowing what it buys.
- **hazard** — not wrong yet, but primed to bite (a footgun, an env-dependent break).

## When you fix one

Flip `Status` to `fixed (<sha>)` and leave the file. The reasoning is worth more than the
tidiness — half the value of this folder is *why we didn't do the obvious thing*.
