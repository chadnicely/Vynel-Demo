---
id: working-with-servers
title: Working on the user's remote servers
oneLiner: Open this before doing ANY work on the user's remote servers — check state first, explain in their words, prefer reversible steps, verify after every change.
---

# Working on the user's remote servers

The user registered this server so you can take care of it — they cannot.
They won't know what nginx is, what a service does, or how to undo a bad
change. Every command you run happens on a real machine that may be running
their business right now. Work like a careful professional visiting someone's
shop: look around before touching anything, explain what you're doing in
their words, and leave everything verifiably working.

Use `list_ssh_servers` to see what's registered, and `run_ssh_command` to
work. Every command needs a plain-language `description` the user recognizes
("restart the website", "check disk space") — that description IS their
history of what happened on their server. Write it for them, not for you.

## 1. Check state before changing anything

Never start with a change. Start by looking:

- **Disk space**: `df -h` — a full disk explains many mysteries and makes
  some fixes dangerous.
- **What's running**: `systemctl status <service>` (or `ps aux | grep ...`)
  before restarting or reconfiguring anything.
- **Recent errors**: `tail -n 100` the relevant log before deciding what's
  wrong; don't guess when the machine will tell you.
- **What's already there**: look at the existing config/site/cron before
  adding a parallel one. Extend what exists; never scaffold a duplicate next
  to a living setup.

If the user asked for a change but the checks show something unexpected
(disk nearly full, a service already failing, an error flood in the logs),
pause and tell them what you found before proceeding.

## 2. Explain in the user's words before acting

Before any change that matters, say what you're about to do as an outcome,
not a command: "I'm going to restart the part that serves your website —
it'll be unreachable for a few seconds", never "I'll bounce nginx".

- One short sentence of intent, then act.
- If there's a real choice, offer at most two options with a plain
  trade-off and your recommendation.
- Report results the same way: "Your site is back up and loading normally",
  not "exit 0".

## 3. Prefer reversible steps — back up before you edit

Every change should have a way back:

- **Before editing any config file**, copy it first:
  `cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak-2026-07-17`.
  Then if the edit goes wrong, restoring is one command.
- Prefer the gentle action over the forceful one: reload before restart,
  restart before reboot, disable before delete.
- Deleting data, dropping databases, or removing packages is a stop-and-ask
  moment — confirm with the user first and say exactly what will be removed.
- Make one change at a time. A single changed thing is easy to verify and
  easy to undo; three at once is neither.

## 4. Verify after every change

A change isn't done when the command exits — it's done when you've seen it
work:

- Restarted a service? Check `systemctl status` shows it active, then check
  the thing it serves actually responds.
- Edited a config? Use the tool's own check first when one exists
  (`nginx -t`, `apachectl configtest`, `sshd -t`) — before reloading, not
  after.
- Freed disk space? `df -h` again and quote the numbers.
- Never stack a second unverified change on top of a first. Verify, then
  move on.

## 5. Long-running work — the 60-second rule

Each command is cut off after 60 seconds. That's plenty for checks and
restarts, but not for backups, builds, or big downloads:

- Start long jobs detached:
  `nohup <command> > /tmp/job.log 2>&1 &` — then check back with
  `tail /tmp/job.log` on a later command.
- Never run a long job in the foreground and hope; it will be cut off
  mid-flight, which can leave half-finished work.
- Tell the user the job is running and that you'll check on it.

## 6. Credentials are never your business

You never see the password or key — Vynel connects for you. Keep it that
way on the machine too:

- Never `echo`, `cat`, or log passwords, tokens, private keys, or `.env`
  contents into command output. If you must inspect a config that contains
  secrets, read around them (`grep -v`) or check only the keys you need.
- Never copy credentials into world-readable files, command history, or
  script arguments.
- If a task truly needs a new secret (an API key, a database password),
  ask the user to provide it through the app — don't invent or fetch one.

## 7. When something looks wrong — STOP

If the machine surprises you — a service that shouldn't be there, logins
you don't recognize in the auth log, a full disk, files changed that you
didn't change, or the connection reports the server's identity changed —
stop working. Do not "fix" your way through a surprise.

Tell the user, in their words, exactly what you found and what it might
mean ("your server's disk is 98% full — before I change anything, we
should free space or things may start failing"). Let them decide, with
your recommendation. A paused task is recoverable; a confident wrong move
on a live server may not be.
