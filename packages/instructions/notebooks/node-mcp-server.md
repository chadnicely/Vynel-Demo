---
id: node-mcp-server
title: Building an MCP server in Node — tools over your app
oneLiner: Open this when an application's capabilities should be callable by an AI assistant — how to design MCP tools as thin adapters over the app's core, and expose them through a Node MCP server.
---

# Building an MCP server in Node — tools over your app

An MCP server makes an application's capabilities callable by an AI
assistant (Claude Code, Claude Desktop, or any MCP client): each capability
becomes a **tool** with a name, a description the model reads, a typed
input schema, and a handler. The law that keeps it maintainable: **a tool
is a thin adapter over an existing core operation or API route — never a
second implementation of business logic.** If a tool needs logic the app
doesn't have, build the operation in the app first, then wrap it.

Use the provider-neutral **`@modelcontextprotocol/sdk`** package.

## 1. Design the tools before writing the server

- **One tool = one operation**, named as `verb_noun` in the feature's own
  vocabulary: `list_orders`, `create_invoice`, `search_customers`. No
  grab-bag "do anything" tools.
- **The description is written FOR THE MODEL** — it is the only manual the
  assistant gets. Say what the tool does, when to call it, what it
  returns, and whether it changes anything: "READ-ONLY. Call this before
  …" beats a one-word label. A vague description produces wrong calls.
- **Declare honesty annotations**: `readOnlyHint: true` on pure reads,
  `destructiveHint: true` on anything that deletes or overwrites. Clients
  use these to decide what needs user approval.
- Start read-only. Add mutating tools one at a time, each deliberately —
  every mutating tool is something an AI can now do unattended.

## 2. The tool contract — schema in, text out, errors flagged

Every tool follows the same skeleton:

```ts
server.registerTool(
  'list_orders',
  {
    description: "List the user's open orders. READ-ONLY. Returns id, status, total.",
    inputSchema: { status: z.enum(['open', 'closed']).optional() },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    try {
      const orders = listOrders(db, { status: args.status })
      return { content: [{ type: 'text', text: JSON.stringify({ count: orders.length, orders }) }] }
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      }
    }
  },
)
```

- **Zod schemas validate every input** — the model is an untrusted caller
  like any other; nothing unvalidated reaches the core.
- **Return structured JSON as text**, shaped for reading: include counts,
  ids, and the fields the model needs to act — not raw database rows.
- **Never throw across the boundary.** Catch, and return `isError: true`
  with a message that tells the model what went wrong and what to try
  instead. A thrown error kills the call; a flagged error teaches.
- Keep the response builder a plain exported function
  (`buildListOrdersResponse(db, args)`) and have the tool wrap it — the
  builder is then directly testable without any MCP machinery.

## 3. Assemble the server — one per feature domain

Group tools into a server named for the app or feature
(`myapp-orders`), version it, and keep the assembly file dumb: import
tool factories, register, done. Tool call names reach the model as
`mcp__<server>__<tool>`, so the server name is part of the vocabulary —
keep it short and stable.

If the app already has the typed API + SDK chain (**node-sdk-from-api**),
DERIVE the tools instead of hand-writing them: annotate each route that
should be exposed (`'x-mcp': { exposed: true, name, description }` in its
OpenAPI metadata), then either generate the tool registrations from the
committed spec or register them at boot by reading it. One source of
truth — a route change updates the tool, and an unannotated route is
invisible to the model by default. Exposure is opt-in per route, never
"everything".

## 4. Expose it — transports

- **stdio** is the default for local clients (Claude Code, Claude
  Desktop): the client spawns your executable and speaks MCP over
  stdin/stdout. **stdio discipline is absolute: stdout belongs to the
  protocol — every log, warning, and status line goes to stderr.** One
  stray `console.log` corrupts the channel.

```ts
const server = new McpServer({ name: 'myapp', version: '1.0.0' })
// …register tools…
await server.connect(new StdioServerTransport())
```

- The client configures it with a command line — give the user one JSON
  snippet for their client config (`command` + `args` + `env`), and read
  configuration (API URL, keys) from environment variables validated at
  boot. Secrets never land in code or in the tool responses.
- **Streamable HTTP** is for remote/shared servers — same server object,
  different transport. Reach for it only when the server genuinely runs
  away from the user's machine; it brings auth and hosting concerns stdio
  doesn't have.
- The server process itself stays stateless where possible: it dispatches
  to the app's API or opens the app's database read path — it is a
  surface, exactly like a route layer, and holds no business state.

## 5. Safety rules for tools the model can call

- Mutating tools pass through the SAME validation and authorization the
  HTTP routes use — the MCP surface is not a back door around the app's
  rules.
- Destructive operations (delete, overwrite, send, publish) either stay
  unexposed or sit behind the client's approval flow via honest
  annotations. Never mark a mutating tool `readOnlyHint` to "reduce
  friction".
- Responses must never leak secrets, tokens, or other users' data — the
  tool shapes output like a public API response, not a debug dump.

## 6. Testing

- Test the **response builders** directly: real temp database (or a
  stubbed dispatch function if the server fronts an HTTP API), call the
  builder, assert on the parsed JSON — including the `isError` paths.
- Test the **assembly**: the server exposes exactly the expected tool
  names, with the expected read-only/mutating split — a new tool joining
  the server is a deliberate, test-visible event.
- If tools are derived from the API spec, add a parity check to the test
  gate so the committed spec and the registered tools can never drift.
