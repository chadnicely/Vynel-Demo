---
description: Sync the git-tracked design mirror (.claude-design/project/) from a claude.ai/design export zip. Every sync is one commit, so git diff .claude-design/ between syncs is the upstream design-change worklist.
argument-hint: <path-to-export.zip>
allowed-tools: Bash, Read, Write, Glob
---

Keep `.claude-design/project/` — the git-tracked mirror of Vynel's Claude Design project — in
step with the design on claude.ai. `.claude-design/README.md` says what the pack is; this command
is how it stays fresh.

> **Why git-tracked?** When Chad iterates the design upstream, the mirror updates and
> **`git diff .claude-design/`** shows exactly what changed — the worklist for updating the real
> UI. Faithfulness matters, so the sync uses a byte-clean **export zip**, never a regenerated or
> hand-reassembled copy.

## The sync — `$1` is the path to the export zip

Chad downloads the project from the claude.ai design UI; the zip usually lands in
`C:\Users\KLONE\Downloads\`. No `unzip`/`python3` in this WSL — **Windows bsdtar reads zips**:
use `tar.exe -tf` / `tar.exe -xf` with the zip as a `C:\…` path.

1. **List + detect the layout:** `tar.exe -tf "<zip as C:\ path>"`.
   - `*.dc.html` files at the zip root → a **project download** (the normal case): the zip root
     IS the pack root.
   - a single wrapper dir containing `project/` → a **handoff bundle**: the pack root is
     `<wrapper>/project/`, and `<wrapper>/README.md` goes to `.claude-design/PACK-README.md`.
2. **Extract into gitignored staging:** `mkdir -p .tmp/zipsync` then
   `tar.exe -xf "<zip as C:\ path>" -C "E:\KLONE\Workspace\vynel\.tmp\zipsync"`.
3. **Sentinel check** — is this really a Claude Design pack? Under the pack root: at least one
   `*.dc.html`, plus `support.js`, plus `_ds/*/_ds_manifest.json`. Anything missing → stop and
   ask for a fresh export; do not touch the live mirror.
4. **Swap with `mv`** — git is the backup, so never `rm -rf` the live mirror:
   `mv .claude-design/project .tmp/old-project-<free suffix>` then
   `mv <staged pack root> .claude-design/project`. Re-verify the sentinel under
   `.claude-design/project/`. Leftover `.tmp/old-project-*` is harmless — `.tmp/` is gitignored.
   (DrvFS note: an `ls` immediately after a big `mv` can transiently report "No such file or
   directory" — re-check before concluding the move failed.)
5. **Diff, report, commit:** `git add -A .claude-design/`, then walk `git status --short` and the
   text diffs (canvases added / removed / edited, `_ds` token changes) and report THAT as the
   upstream-change worklist. Commit: `chore(design): sync design mirror from export zip`.

## Never

- ❌ Hand-edit anything under `.claude-design/project/` — pure mirror, wholesale-replaced every
  sync. Hand-authored notes live at `.claude-design/README.md` or in `docs/`.
- ❌ `rm -rf` the live mirror — swap with `mv`; git is the backup.
- ❌ Rebuild the pack via the DesignSync connector. This is a **canvas project**; the connector's
  `list_projects` surfaces only design-*system* projects, so it cannot see this one. (The
  "Vynel Design System" project on claude.ai — id `3c267be9-d21e-4619-ae53-3ab0566dc6c2` — is
  **not** what these canvases consume; the pack bundles its own `_ds/nocturne-*` copy. Don't wire
  it in.)
