# Session instructions

The always-on identity/operating prompts Vynel appends to a session's system
prompt. Each `<id>.md` in this directory **is** one prompt — the filename says
which session it governs, and the whole file body is injected verbatim. Edit a
file to change how that scope behaves — no code change, no rebuild. Each file is
read once and cached for the process's lifetime, so a running app picks up your
edit after a **restart**.

| File | Governs |
|---|---|
| `global-root.md` | The global brain — the router above all workspaces (web + voice + channel root turns). |
| `workspace-agent.md` | The assistant working inside a workspace — appended to every workspace chat turn (including resumed ones). |
| `voice-turn.md` | A modifier appended on top of `global-root.md` for voice turns only. The spoken thread's text IS its voice (the client speaks the streamed deltas), so the `speak` tool is NOT attached on a voice turn — this file teaches the spoken style and says the tool is gone. |
| `voice-turn-marker.md` | The one-line sibling of `voice-turn.md`, appended to a voice turn's USER MESSAGE (provider input only) — on a long root session the system-prompt block decays and the model slips back to essay-shaped replies; the per-message restatement keeps the spoken style, and the "no `speak` tool" line, in recency (the thread's own transcript is full of the model's older `speak` calls, and a resumed turn will copy them). |
| `schedule-fire-marker.md` | The frame on a FIRED schedule prompt, appended to the provider input only (both fire paths — global root and workspace): the scheduler is speaking, not the user, and the instruction is to be carried out NOW (never a timer, never sleep, never asking back). The one templated instruction — `{{scheduleName}}` / `{{firedAtLocal}}` are filled by `renderScheduleFireMarker` (keep both placeholders when editing). |
| `turn-time-marker.md` | What time it is where the user is, appended to every turn composed by the two provider-message homes — interactive chat/voice/channel turns and fired schedule turns, not routed delegation turns — (provider input only: `start-chat-turn.ts` and `compose-global-root-provider-message.ts`). A model reads no clock, so a relative question was answered off a guessed hour ("02:51 + 15 min = 2:07"). Templated — `{{nowLocal}}` / `{{timezone}}` are filled by `renderTurnTimeMarker` from the user's `users.timezone` (keep both placeholders when editing). |

## Rules for editing these files

- **The whole file is the prompt.** Do NOT add comments, frontmatter, or notes —
  every character reaches the model. Put explanatory notes here in the README.
- **`global-root.md` is load-bearing.** LLM-native routing only works because the
  prompt names the routing tools (`list_routing_workspaces`, `send_task_to_workspace`,
  `list_routing_channels`, `send_to_channel`) — dropping a name silently breaks
  routing. Routing is fire-and-forget: `send_task_to_workspace` returns immediately and
  the report arrives later, so the prompt must NOT tell the model to wait for a
  result. A colocated test guards the tool names.
- **`workspace-agent.md`** carries the general operating protocol (plain language,
  ask-don't-invent, approval discipline). The user knows the assistant as "Vynel",
  not the underlying runtime.

Loaded at runtime by `src/session-instructions/load-session-instruction.ts`
(read from disk, cached for the process lifetime, fail-loud on a missing/empty
file). Consumed through the SDK-free `@vynel/instructions/session-instructions`
subpath so a prompt reader never pulls the notebook MCP graph.
