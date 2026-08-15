# 2026-08-13 — virtual audio driver night run (P0/P1/P2/P4)

Autonomous overnight arc on `worktree-virtual-audio-driver`; brief + results in
`docs/module-notes/virtual-audio-driver.md`. Learnings worth keeping:

- **EWDK beats installing VS+WDK for unattended boxes.** Mount-and-run, no admin, no
  UAC-prompt-hang risk mid-automation, deletable, machine unmutated. One limitation found: its
  msbuild cannot NuGet-restore `PackageReference` projects (sysvad's wil-dependent user-mode
  APO samples fail) — kernel targets don't care.
- **The ACX AudioCodec sample is a virtual device and brandable by design** — `ROOT\AudioCodec`
  hardware id, `DriverSettings.h` centralizes every identity GUID with a "replace these" note.
  A full brand is: 3 GUIDs + a WPP GUID + INF strings + version resources + a pool tag; the
  internal circuit names can stay, keeping every `.cpp` byte-identical to the sample —
  provable with a plain `diff -r`, which is a stronger review than eyeballing a vendored tree.
- **Windows-git worktrees are invisible to WSL git** (`gitdir: E:/…`) — every git op must go
  through `cmd.exe`, and commit messages survive quoting only via `-F <file>`.
- **Reviewer catch to generalize:** converting a `main()` to async silently turns
  crash-on-boot into log-and-linger (exitCode waits for the event loop; live audio handles
  keep it alive forever). Pair every async composition root with a hard-exit `.catch`.
- **Process loopback (Win10 2004+) halves the Windows driver:** ears = per-app capture with no
  device at all, so Vynel's driver only needs the voice direction. One cable per call.
- **One naming contract across OSes pays immediately:** "Vynel Call <n> Ears/Voice"
  (Vynel-facing) + "Microphone/Speaker" (app-facing) let P4's discovery, P2's Linux pool, and
  the P1 INF ship against the same strings — and the registry's per-end dedupe makes any
  overlap between discovered and env inventories fail safe instead of cross-bleeding calls.
