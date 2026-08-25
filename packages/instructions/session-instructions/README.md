# Session instructions

The always-on identity/operating prompts that ARE a session's system prompt —
Claude Code's own preset is not used (since 2026-08-26); the SDK frames our text
with its one-line identity only. Each `<id>.md` in this directory **is** one prompt — the filename says
which session it governs, and the whole file body is injected verbatim. Edit a
file to change how that scope behaves — no code change, no rebuild. Each file is
read once and cached for the process's lifetime, so a running app picks up your
edit after a **restart**.

**The identity stack (base + kind + task):** every session's identity is
composed by `composeSessionInstruction(kind, { voice, agentName })` as ONE base
+ the session's KIND file. The base carries what every session shares — the
operating rules and the output format — and is picked by CHANNEL: text sessions
read `base.md`, voice turns read `voice-base.md` (written for the ear, so a
spoken turn is never handed prose rules it has to un-learn). The kind file says
what that session IS. The third layer is per-turn: a routed task's steer and
the manager's own instructions ride the task message, after the stack.

| File | Governs |
|---|---|
| `base.md` | The TEXT base — every text session's shared identity: who you are (Claude, working through the Claude Agent SDK inside Vynel), the harness facts Vynel supplies instead of Claude Code's preset (how text reaches the user, the approval card + declined calls, `<system-reminder>` tags, compaction, tool hygiene), the operating rules (plain language, ask-don't-invent, real schedules, scope discipline, faithful reporting) and how to format written replies. |
| `voice-base.md` | The VOICE base — replaces `base.md` on voice turns. The spoken thread's text IS its voice (the client speaks the streamed deltas), so the `speak` tool is NOT attached — this file teaches the spoken style, says the tool is gone, and re-states the shared ground rules spoken-sized. |
| `global-root.md` | KIND: the global brain — the router above all workspaces (web + voice + channel root turns). |
| `workspace-manager.md` | KIND: the workspace's MANAGER — the workspace primary session, on every one of its turns (interactive chat, schedule fires, and routed background turns alike): it runs the project's work and manages child sessions, sending each task with clear instructions. |
| `spawned-session.md` | KIND: a CHILD session opened for one assignment by whoever manages it (a workspace manager or the global brain). The task message carries the manager's instructions; the reporting protocol rides the routed steer that follows this file. |
| `agent-colleague.md` | KIND: a persistent agent colleague's continuing session. Templated — `{{agentName}}` is filled by `composeSessionInstruction('agent-colleague', { agentName })` (keep the placeholder when editing); the agent's own persona prompt is appended after the stack. |
| `workspace-session.md` | KIND: a plain workspace session (opened by id / started fresh, no continuing identity — the duty-book `plain` kind). Content-first, the duty-book precedent: no live door composes it yet; the file is ready for the plain door when it lands. |
| `voice-turn-marker.md` | The one-line sibling of `voice-base.md`, appended to a voice turn's USER MESSAGE (provider input only) — on a long root session the system-prompt block decays and the model slips back to essay-shaped replies; the per-message restatement keeps the spoken style, and the "no `speak` tool" line, in recency (the thread's own transcript is full of the model's older `speak` calls, and a resumed turn will copy them). |
| `schedule-fire-marker.md` | The frame on a FIRED schedule prompt, appended to the provider input only (both fire paths — global root and workspace): the scheduler is speaking, not the user, and the instruction is to be carried out NOW (never a timer, never sleep, never asking back). The one templated instruction — `{{scheduleName}}` / `{{firedAtLocal}}` are filled by `renderScheduleFireMarker` (keep both placeholders when editing). |
| `turn-time-marker.md` | What time it is where the user is, appended to every turn composed by the two provider-message homes — interactive chat/voice/channel turns and fired schedule turns, not routed delegation turns — (provider input only: `start-chat-turn.ts` and `compose-global-root-provider-message.ts`). A model reads no clock, so a relative question was answered off a guessed hour ("02:51 + 15 min = 2:07"). Templated — `{{nowLocal}}` / `{{timezone}}` are filled by `renderTurnTimeMarker` from the user's `users.timezone` (keep both placeholders when editing). |

## Rules for editing these files

- **The whole file is the prompt.** Do NOT add comments, frontmatter, or notes —
  every character reaches the model. Put explanatory notes here in the README.
- **The two bases are deliberately parallel.** `base.md` and `voice-base.md`
  state the same core disciplines phrased per medium — when you change a rule in
  one, check the other. A colocated test pins the shared core to both files.
- **`global-root.md` is load-bearing.** LLM-native routing only works because the
  prompt names the routing tools (`list_routing_workspaces`, `send_task_to_workspace`,
  `list_routing_channels`, `send_to_channel`) — dropping a name silently breaks
  routing. Routing is fire-and-forget: `send_task_to_workspace` returns immediately and
  the report arrives later, so the prompt must NOT tell the model to wait for a
  result. A colocated test guards the tool names.
- **`base.md` carries the general operating protocol** (plain language,
  ask-don't-invent, approval discipline, real schedules) and the reply format.
  The user knows the assistant as "Vynel", not the underlying runtime — that
  line lives in both bases.

Loaded at runtime by `src/session-instructions/load-session-instruction.ts` and
stacked by `compose-session-instruction.ts` (read from disk, cached for the
process lifetime, fail-loud on a missing/empty file). Consumed through the
SDK-free `@vynel/instructions/session-instructions` subpath so a prompt reader
never pulls the notebook MCP graph.