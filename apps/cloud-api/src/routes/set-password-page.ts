// The hosted set-password PAGE — the link in invite/reset emails lands here,
// so workshop users never see a terminal (the product thesis). Deliberately
// dependency-free inline HTML: one form, posts to /auth/set-password, shows
// the outcome. Styling is minimal-neutral; the desktop app is the product,
// this page is a doorstep.

import { Hono } from 'hono'

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set your Vynel password</title>
<style>
  body { font-family: system-ui, sans-serif; background:#14171c; color:#e8e6e3;
         display:flex; justify-content:center; padding-top:12vh; margin:0; }
  main { width: 22rem; }
  h1 { font-size:1.15rem; font-weight:600; }
  p  { color:#a9a6a1; font-size:.9rem; line-height:1.5; }
  label { display:block; font-size:.8rem; margin:1rem 0 .3rem; color:#a9a6a1; }
  input { width:100%; box-sizing:border-box; padding:.55rem .7rem; border-radius:8px;
          border:1px solid #33383f; background:#1b1f26; color:inherit; font-size:.95rem; }
  button { margin-top:1.2rem; width:100%; padding:.6rem; border-radius:8px; border:0;
           background:#e8e6e3; color:#14171c; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .msg { margin-top:1rem; font-size:.85rem; }
  .msg.err { color:#e07a6a; }
  .msg.ok  { color:#8fbf7f; }
</style>
</head>
<body>
<main>
  <h1>Set your Vynel password</h1>
  <p>Choose the password you'll use to sign in to the Vynel app. At least 10 characters.</p>
  <form id="form">
    <label for="pw">New password</label>
    <input id="pw" type="password" minlength="10" maxlength="200" required autocomplete="new-password">
    <label for="pw2">Repeat it</label>
    <input id="pw2" type="password" minlength="10" maxlength="200" required autocomplete="new-password">
    <button id="go" type="submit">Set password</button>
    <div id="msg" class="msg" role="alert"></div>
  </form>
</main>
<script>
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const form = document.getElementById('form');
  const msg = document.getElementById('msg');
  const go = document.getElementById('go');
  if (!token) { msg.textContent = 'This link is missing its token — use the full link from your email.'; msg.className = 'msg err'; go.disabled = true; }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('pw').value;
    if (pw !== document.getElementById('pw2').value) {
      msg.textContent = "The two passwords don't match."; msg.className = 'msg err'; return;
    }
    go.disabled = true; msg.textContent = ''; msg.className = 'msg';
    try {
      const res = await fetch('/auth/set-password', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        form.querySelectorAll('input,button').forEach((el) => { el.disabled = true; });
        msg.textContent = 'Done — open the Vynel app and sign in with your email and this password.';
        msg.className = 'msg ok';
      } else {
        msg.textContent = body.message ?? 'That did not work — request a fresh link and try again.';
        msg.className = 'msg err'; go.disabled = false;
      }
    } catch {
      msg.textContent = 'Network problem — check your connection and try again.';
      msg.className = 'msg err'; go.disabled = false;
    }
  });
</script>
</body>
</html>`

export function buildSetPasswordPage() {
  return new Hono().get('/', (c) => c.html(PAGE_HTML))
}
