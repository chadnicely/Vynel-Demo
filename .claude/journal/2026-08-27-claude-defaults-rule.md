# 2026-08-27 — Claude defaults rule (a teammate's "Credit balance is too low")

A teammate on a Max subscription saw the account popup read "API Key" and every turn fail with
`Claude Code returned an error result: Credit balance is too low`. No code changed; the outcome
is a **product rule** and a **support recipe**.

## The chain (verified in SDK 0.3.235 + the bundled `claude.exe`)

1. `daemon.rs` spawns the engine with the desktop app's inherited env (no `env_clear`);
   `build-claude-sdk-options.ts` never sets `env`; the SDK defaults it to `{...process.env}` — so
   every host env var reaches `claude.exe`.
2. The CLI's key resolver, non-interactive branch (`Cn()` = `!isInteractive`): an env
   `ANTHROPIC_API_KEY` is used **unconditionally**. The interactive "Do you want to use this API
   key? No (recommended)" consent (`~/.claude.json` → `customApiKeyResponses`, keyed by the key's
   last 20 chars) only gates interactive sessions. Official precedence: env key (#3) outranks
   subscription OAuth (#7); the support article says so in as many words.
3. "Credit balance is too low" is the CLI's normalized `billing_error` for the Console/prepaid
   path (`OIa(e)` = message includes "credit balance is too low"). A subscription session can
   never produce it — the error itself proves the key was used.
4. The popup's "API Key" with no email = `read-claude-authentication-status.ts` short-circuiting
   on `readHostOsEnvVar('ANTHROPIC_API_KEY')` (or settings.json `env`) before the CLI JSON; a
   Console login would have shown an email instead.

His data: `ANTHROPIC_API_KEY` User = SET, Machine = not set; settings.json/claude.json clean;
`.credentials.json` → `subscriptionType: "max"`. Fix on his machine:
`[Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', $null, 'User')`, quit Vynel (tray
too), relaunch. Popup then shows email + Max plan + Subscription. Working.

## Decision (Kafi, 2026-08-27) — LOCKED

**Vynel keeps ALL of Claude Code's default config and behavior. Where a default conflicts with
what Vynel would prefer, the conflict is ignored — Claude's behavior wins.** Concretely:

- No stripping of `ANTHROPIC_API_KEY` (or any credential var) from the SDK env; no
  subscription-over-key precedence of our own; no reading of `customApiKeyResponses`.
- The shared `~/.claude.json` / `~/.claude/` home stays (it is the bundled runtime's own home —
  sign-in once, MCP servers + folder trust, plugins, rules/skills/agents interop). No
  `CLAUDE_CONFIG_DIR` isolation — it would not have prevented this anyway (the key came from the
  OS env, which the CLI reads regardless of config dir).
- An API-key symptom on a subscription machine is a HOST problem, fixed on the host.

The two fix shapes that were on the table (mirror the CLI's consent record; always strip) are
recorded here so nobody rebuilds them: both rejected by this rule.

## Support recipe (presence only — never the key value)

```powershell
foreach ($s in 'Process','User','Machine') { "ANTHROPIC_API_KEY ($s): " + $(if ([Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY',$s)) {'SET'} else {'not set'}) }
Get-ChildItem Env: | Where-Object { $_.Name -like 'ANTHROPIC_*' -or $_.Name -like 'CLAUDE_CODE_*' } | Select-Object Name
"settings.json has apiKeyHelper/env key: " + ((Get-Content "$HOME\.claude\settings.json" -Raw -ErrorAction SilentlyContinue) -match 'apiKeyHelper|ANTHROPIC_API_KEY')
"claude.json has primaryApiKey: " + ((Get-Content "$HOME\.claude.json" -Raw -ErrorAction SilentlyContinue) -match '"primaryApiKey"')
"subscription: " + (Select-String -Path "$HOME\.claude\.credentials.json" -Pattern '"subscriptionType":\s*"[^"]*"' -ErrorAction SilentlyContinue).Matches.Value
```

Plus: installed build or repo mode (repo mode loads `.env` via `--env-file-if-exists`). The
installed app's data home is `%APPDATA%\Vynel` (`config.env` optional, `logs\daemon.log`) — not
the identifier dir.
