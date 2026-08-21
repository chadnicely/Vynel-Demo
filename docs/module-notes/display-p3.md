# Display — P3, presence (plan, 2026-08-21)

P1 = the room, P2 = widgets. P3 makes the Display *present* when you are not looking at it: the **display dock**
(the mini Display where the desktop-control window sits, stacked above it), **wake opens the app** and switches
it to the Display, and the orb reacting to the daemon leg. Decisions from `display-research.md` §5 (accepted):
the dock is the existing always-on-top voice window in a mini mode — no third window; the in-app web speech leg
stays primary, the daemon leg is the wake path.

## Today's pieces (verified in research §2)

- The voice window: Tauri label `display-dock` (`windows.rs:75-89`, 420×560, transparent, always-on-top, skip-taskbar,
  hidden until wake), route `/display-dock` → `views/DisplayDockView.vue` (`createOverlayWindowControls`, `parkCenter()`,
  `reveal()/dismiss()` on wake/end, title "Vynel Display" which the daemon's `focus()` matches by name), launched by
  the daemon with `--dock-only` (`apps/voice/src/overlay/display-dock-window.ts:108`), env `VYNEL_VOICE_DOCK_*`,
  capability file `capabilities/display-dock.json`.
- The desktop-control window: label `desktop-overlay` (`windows.rs:96-106`, 380×360), parked bottom-right by
  `tauri-overlay-window.ts:54-69` (`CORNER_MARGIN = 16`), shown/hidden by `desktop-activity-fold.ts:317-321`
  (`isDesktopOverlayVisible`: running step / pending approval / 20 s after activity).
- Wake → app: `main.rs:44-52` single-instance handler calls `open_main_window()` on an argless second launch —
  nobody exercises it. The main window declares NO wake capability (deliberate, voice-routing slice).

## Naming — DECIDED (Kafi): full rename, SHIPPED

The product rule is "no borrowed hero names", and the dock IS the Display's mini form. Renamed in one slice:

| old | new |
|---|---|
| Tauri window label `jarvis` | `display-dock` |
| route `/jarvis`, `views/JarvisView.vue` | `/display-dock`, `views/DisplayDockView.vue` |
| window title "Vynel Jarvis" | "Vynel Display" (daemon `focus()` matches by title — both ends moved together) |
| `capabilities/default.json` (id `jarvis-window`) | `capabilities/display-dock.json` (id `display-dock-window`) |
| `--jarvis-only` | `--dock-only` |
| `apps/voice/src/overlay/jarvis-window.ts` | `display-dock-window.ts` (`createDisplayDockWindow`) |
| wire surface literal `'jarvis'` (`VoiceSurface`/`OverlaySurface`, `voice:jarvis[:wake]`, `?surface=jarvis`) | `'dock'` |
| env `VYNEL_VOICE_JARVIS_{WINDOW,URL,BROWSER,APP}` | `VYNEL_VOICE_DOCK_{WINDOW,URL,BROWSER,APP}` |

The env knobs are user-facing config, so the OLD names stay accepted for ONE release:
`applyDeprecatedVoiceEnvAliases` in `apps/voice/src/env.ts` merges them into the raw object before the Zod
schema sees it — one home rather than four per-field `preprocess` hooks — and the NEW name wins when both are
set. Drop that map and `env.test.ts` after the release.

The repo's product-level channel naming went with it: "Voice/Jarvis" → "Voice" in `CLAUDE.md`,
`README.md`, `apps/README.md`, `docs/architecture.md` and `docs/vision.md`.

**One deliberate residue, awaiting a product call:** the retired spellings in `WAKE_NAME`
(`packages/voice/src/turn-taking/wake-word.ts:25`) still let a user who says the old name be *heard*.
Dropping them is a behaviour change, not a rename, so it was left for Kafi — and the wake-word tests
now exercise "hey vynel"/"hey claude" only, so that alternation is currently unpinned.

## Slices

**Carried over from P2 — re-advertise the `dock` slot.** P2 shipped the slot in the schema, the contracts and
the leaf, but took `'dock'` out of the `display_add_widget` tool DESCRIPTION (a card sent somewhere nothing
renders is a card the user never sees). P3a must put it back in that sentence
(`apps/local-api/src/routes/display/index.ts`) and regenerate — otherwise the dock ships with no way for Claude
to fill it. The census test in `apps/mcp/src/generated/api-tools.test.ts` pins the current state and must flip
with it.

| | Owns | Delivers |
|---|---|---|
| **P3a dock mode** | `views/DisplayDockView.vue` (the renamed voice window view), `composables/display/use-display-dock-parking.ts`, `tauri-overlay-window.ts` (a `park: 'bottom-right'` with a stacking offset), `windows.rs` size/label, capabilities file | two parking spots: **center** on wake (today's behaviour, for the wake conversation) and **mini bottom-right** (≈ 380×140: small orb + last caption + mic pill + the `dock` slot widgets from `use-display-widgets`) whenever a voice session is live and the app's Display is NOT active; stacked ABOVE the desktop-control window when that one is visible — same rule, one home: the dock subscribes `activity` and reuses `isDesktopOverlayVisible` to pick the offset. Rule: the in-app Display active → the dock hides (the room owns the orb); the user leaves the Display mid-session → the dock reveals mini. |
| **P3b wake opens the app** | `apps/voice/src/overlay/display-dock-window.ts`, `apps/voice/src/main.ts` wake policy, `packages/contracts/src/voice/daemon-events.ts`, `use-voice-daemon-link.ts`, `AppShell.vue` | the daemon, on wake with `VYNEL_VOICE_DOCK_WINDOW=1`: opens/focuses the dock as today AND spawns the exe argless → the single-instance handler surfaces the main window; a new daemon event `{ kind: 'show-display' }` rides `voice:app` (app surfaces only, never a wake target) → `AppShell` opens the Display via `use-display-toggle`; the dock then hides (rule above) and the in-app room takes the conversation over — define the hand-over honestly: the wake session stays in the dock window's leg until it ends (no mid-turn migration of a Web Speech session across windows); the room shows the orb reacting to the daemon leg (`isDaemonSpeaking`) and its own mic stays muted until the dock session ends, then resumes. |
| **P3c orb from the daemon leg** | `display-orb-state.ts`, `DisplayView.vue`, the dock view | listening/speaking from `voice:<surface>` state frames when the conversation runs on the daemon leg; spike per relayed clause; energy from status as today. |

## Acceptance

- Say the wake word with the app closed → the app opens on the Display, the dock shows the wake conversation
  (center), the room's orb mirrors it; when that session ends the room's own mic takes over.
- In the Display, start talking, switch to a workspace → the dock appears mini bottom-right with the last caption
  and the mic live; start a desktop-control task → the dock shifts up above the progress window; return to the
  Display → the dock hides.
- A voice turn that calls `display_add_widget` with `slot: 'dock'` shows that widget in the mini dock.
- No second microphone ever: at most one live Web Speech session per user across the app window and the dock.
