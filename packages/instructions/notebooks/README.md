# Verified notebooks — the team's shelf of books

Every `.md` file in this directory (except this README) ships as a **verified
notebook**: a book of current, curated best-practice guidance that the
assistant opens on demand — via the `vynel-notebook` MCP tools — when a task
calls for it. Books are reference material, not prompt padding: they are never
injected wholesale into a turn, never editable in the UI, and always win an id
collision against a user-authored document.

## Adding a book

Drop a markdown file here. It must open with a frontmatter block:

```markdown
---
id: my-playbook-id
title: Human-readable title
oneLiner: One sentence describing when to open this book.
---

The book's markdown body starts here.
```

Rules (enforced loudly at load — a malformed file fails the boot naming the
file):

- `id` — kebab-case (`lowercase-words-joined-by-hyphens`), unique across the
  directory. This is the handle the assistant passes to `read_playbook`.
- `title` — nonempty; shown in the `list_playbooks` shelf view.
- `oneLiner` — nonempty, one sentence; it is how the assistant decides whether
  the book matches the task at hand, so make it concrete.
- The body below the frontmatter must be nonempty markdown.

## Writing a good book

- Write for the assistant, in imperative voice: what to do, in what order, and
  what to check before moving on.
- Keep it CURRENT — a book is the team's latest verified guidance ("research
  with the latest data"), so update it when best practice moves.
- The end user is non-technical: books should tell the assistant how to carry
  the user through the work in plain language, not assume the user manages any
  of it.
