# Instructions — the notes (module notes)

The system prompt is the part of Vynel that decides how the assistant behaves, so its notes live
here, together, end to end. The prompt FILES themselves are the editable markdown in
`packages/instructions/session-instructions/` (the whole file is the prompt; restart the engine to
apply); this folder is where we compare, measure and plan them.

| File | What it is |
|---|---|
| `claude-system-prompt.md` | Claude Code's `claude_code` preset **verbatim**, as our bundled CLI actually sends it (captured 2026-08-26) — plus what the SDK sends instead under a custom prompt. The thing we are replacing. |
| `vynel-system-prompt.md` | **Ours, end to end**, rendered through the real composer per session kind (workspace manager, child, global brain, colleague, voice): base → kind → feature sections, with sizes. Compare against the file above; optimize here. |
| `claude-sdk-request-anatomy.md` | The whole API request, section by section: who adds each part (SDK default · preset · `settingSources` · Vynel), whether it survives a custom prompt, and the lever that changes it. Answers "what do we build vs what does the SDK add by default". |
| `native-toolset.md` | Which of the 30 built-in tools Vynel keeps (`CLAUDE_CODE_BASE_TOOL_NAMES`), which it drops and what replaces each, and the per-kind polish still to do. |

Related, elsewhere:

- `../instructions-notebook.md` — the notebook / duty-book arc (playbooks the kind files point at).
- `.claude/journal/2026-08-26-default-prompt-research.md` — why we are moving off the preset
  (measured: preset+append delegated 1/4, a custom prompt 3/4; the user-turn marker 2/2).
- `.claude/journal/2026-08-26-claude-code-tools-captured.md` — the 30 native tool definitions
  verbatim (the toolset is patched with `Options.tools`, never with prompt text).
- `packages/instructions/session-instructions/README.md` — the file-by-file map of the prompt
  files and the rules for editing them.

## How the stack composes (today and after the seam change)

```
system prompt = (the SDK's one-line "You are a Claude agent…" frame; the claude_code preset is GONE since 2026-08-26)
              + base.md | voice-base.md          ← identity + harness + operating rules + reply format
              + <kind>.md                        ← the duty: workspace-manager / spawned-session / global-root / agent-colleague
              + memory contribution (workspace)  ← "what you already know" snapshot
              + feature sections                 ← each McpFeatureDescriptor.contributePrompt, in descriptor order
per turn      + markers on the USER message      ← turn-time · voice-turn · schedule-fire · autopilot · (manager marker, planned)
```

Measured rule of thumb (see the research journal): the standing prompt sets WHO the session is;
what it does NEXT is steered by the per-message marker. Put identity in the files above; put
"do this now" on the user turn.
