# How Claude should press keys and click things — the input-method verdict

**Question (Kafi, 2026-08-11):** *"Research what would be the best acting tools like click, type
— in-process mouse/keyboard input so that no apps block that."* The vision is Claude driving the
user's computer well enough that they can be messaging remotely, on a machine dedicated to Claude.

**Verdict: the stack we already ship is the recommended arrangement, and it is not close.** Our two
tiers map exactly onto Microsoft's own stated hierarchy — accessibility patterns first, synthetic
input second, window messages never. Nothing needs replacing. What this note adds is the honest
list of what *does* block us, and the one open decision it surfaces.

---

## The three mechanisms

| | How it works | Who blocks it |
|---|---|---|
| **UIA control patterns** (`Invoke`, `Value`) | Calls the app's own accessibility implementation — the button's real click handler, not a simulated mouse | Apps with no UIA tree (canvas/custom-drawn); dormant Electron renderers (we wake them) |
| **`SendInput`** | Injects into the OS input stream; the app cannot tell it from hardware | UIPI (elevated windows), secure desktop, kernel anti-cheat |
| **`PostMessage`/`SendMessage`** | Posts fake messages to a window queue | **Unreliable by design — do not use** |

**Why PostMessage is out.** Posted messages "come from the posted message queue", not the input
queue, so keyboard hooks never fire and any app correlating the two desynchronizes. Raymond Chen's
framing: it is like prank-calling the program — it fools some apps and not others. There is no
version of this that is dependable, which is why it never appears in our code.

**Why UIA patterns lead.** Microsoft's own `winappCli` says plainly: prefer the UIA-pattern verbs,
"reserve the injection verbs for scenarios that genuinely need real input." The decisive property
for us is that **Invoke does not require focus** — no foreground fight, no stolen keyboard while
the user is typing, no coordinate math, and it survives a moved or resized window. Synthetic input
must bring the target to the foreground first and fails with `no_interactive_desktop` on a locked
workstation.

**Why SendInput is the right fallback.** It is Microsoft's recommended way to simulate real input
and is indistinguishable from hardware to ordinary apps — which is exactly what "no apps block
that" requires when there is no accessibility tree to address.

## What we ship today (both tiers, already correct)

- **`act_on_app` → UIA control patterns.** `locator.press()` (Invoke), `typeText()`, `setValue()`
  (Value) via xa11y — [`xa11y-adapter.ts:202-211`](../packages/desktop-control/src/a11y/xa11y-adapter.ts).
  Element-addressed, focus-free, resolution-independent.
- **`act_on_desktop` → `SendInput`.** nut.js/libnut, which uses `SendInput` for keyboard, scroll
  and (since the mouse-movement change) cursor motion too — chosen over `SetCursorPos` precisely
  because games and strict apps ignored the latter.

So the fallback ladder the notebook book teaches — **keyboard shortcut → element action → pixel
click** — is not a stylistic preference. Each rung is strictly more fragile than the one above it.

## What actually blocks us (the honest list)

1. **Elevated windows (UIPI).** A non-elevated process cannot `SendInput` into an elevated one;
   Windows silently drops it. Task Manager, regedit, installers, any "Run as administrator" window.
   *This is the only blocker with a real workaround — see the open decision below.*
2. **The secure desktop.** UAC prompts and the lock screen run on a separate desktop that no
   user-mode process can drive. **Unfixable, and correctly so** — it is the wall that stops malware
   from clicking "Yes" on its own elevation prompt. Claude must ask the user to click it.
3. **Kernel anti-cheat.** Competitive games with kernel drivers detect injected input via
   `LLMHF_INJECTED`/`LLKHF_INJECTED` before user mode ever sees it, and increasingly via movement
   statistics. **We treat this as a hard boundary and do not attempt to evade it** — the techniques
   are cheat tooling, they get users banned, and driving a competitive game is not the product.
4. **No accessibility tree.** Canvas apps, custom-drawn UIs, some Electron surfaces. Already
   handled: `screenshot_app` + coordinate acting is the designed fallback, and the Electron wake
   path recovers most Chromium apps.

Nothing on this list is caused by our library choice. Swapping nut.js for anything else changes
none of it — 1 and 3 are OS/driver-level, 2 is by design, 4 is the app's own doing.

## The isolated-machine posture

Kafi's framing — the user runs this on a computer dedicated to Claude, having acknowledged AI can
make mistakes — is a sound risk posture, and it is what makes the plan-approval model (one card per
task rather than per click) proportionate. It does **not** change any technical blocker above:
a dedicated machine still has UAC, still has UIPI, still refuses the secure desktop. Isolation
bounds the *blast radius* of a mistake; it does not widen what Windows lets us drive.

The acknowledgment we ship on the plan card is therefore the right and sufficient user-facing
statement. No further capability follows from it automatically.

## Open decision (surfaced, not taken)

**Should Vynel be able to drive elevated windows?** Two paths, both with real costs:

- **Run the app elevated.** Simple; also means every desktop action Claude takes runs as
  administrator — the plan card would be consenting to far more than it says. Recommend against.
- **Ship a `uiAccess="true"` manifest.** The purpose-built mechanism: it bypasses UIPI *for input
  only*, without full elevation. Costs: the binary must be **Authenticode-signed** and installed to
  a secure location (`%ProgramFiles%`). Both are things the distribution arc is heading toward
  anyway (signing is already deferred-but-planned), so this becomes cheap *later* and is expensive
  now.

**Recommendation: neither, yet.** Keep the current honest failure — when an act is refused because
the window is elevated, Claude tells the user "that window needs administrator rights; could you
click it?" That is a good experience and costs nothing. Revisit the UIAccess manifest once code
signing lands, as a deliberate move with its own review.

## Sources

- [winappCli — UI Automation vs synthetic input (Microsoft)](https://github.com/microsoft/winappCli/blob/main/docs/ui-automation.md)
- [You can't simulate keyboard input with PostMessage, revisited — The Old New Thing](https://devblogs.microsoft.com/oldnewthing/20250319-00/?p=110979)
- [UIPI issues — Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/power-platform/power-automate/desktop-flows/ui-automation/uipi-issues)
- [UIAccess applications and the secure desktop — Microsoft Learn](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/security-policy-settings/user-account-control-allow-uiaccess-applications-to-prompt-for-elevation-without-using-the-secure-desktop)
- [SendInput for mouse movement on Windows — libnut-core](https://github.com/nut-tree/libnut-core/issues/26)
