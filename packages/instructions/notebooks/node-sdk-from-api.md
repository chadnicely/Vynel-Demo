---
id: node-sdk-from-api
title: Building a typed SDK from your API — and wiring it into apps
oneLiner: Open this when a UI or any second app needs to call the project's API — generate a typed SDK from the API's own spec instead of hand-writing fetch calls, and connect every app through one injected client.
---

# Building a typed SDK from your API — and wiring it into apps

The moment an application grows a second caller of its API — a web UI, a
worker, a CLI, tests — hand-written `fetch` calls start to drift: the route
changes, the caller doesn't, and the user sees a broken screen. The cure is
**one generated chain with a single source of truth**:

```
route (validation + metadata) → openapi.json → generated types → SDK client → apps
```

Nothing on that chain is written twice. Change a route, regenerate, and
every consumer either typechecks or fails loudly at build time — never
silently at runtime. This is how this product's own SDK works; build the
user's the same way.

## 1. Make the API describe itself

The API is the single source of truth. Every route already validates its
inputs with zod (the app-scaffold rule); add the OpenAPI description and an
**SDK name** right on the route:

```ts
app.get('/orders',
  describeRoute({
    tags: ['orders'],
    summary: "List the user's orders.",
    'x-sdk-name': 'orders.list',        // ← becomes client.orders.list()
    responses: { 200: { content: { 'application/json':
      { schema: resolver(ListOrdersResponseSchema) } } } },
  }),
  validator('query', ListOrdersQuerySchema),
  (c) => { … })
```

- With Hono, `hono-openapi` derives the spec from these descriptions and
  the zod schemas — serve it at `GET /openapi.json`.
- `x-sdk-name` is `feature.method` (`orders.list`, `orders.create`). Name
  it for the caller's vocabulary, not the URL.
- A route without a response schema is invisible to the chain — every
  response is typed, no exceptions.

## 2. Generate the SDK — never write it

Create `packages/sdk` holding three artifacts, ALL emitted by one script
(`pnpm api:generate`), none ever hand-edited:

- **`openapi.json`** — the spec snapshot. Get it by constructing the app
  in-memory and dispatching `app.request('/openapi.json')` — no server to
  boot, no port to manage.
- **`src/generated/api.d.ts`** — the typed `paths` /components, from the
  snapshot via `openapi-typescript`.
- **`src/generated/namespaced.ts`** — the `client.orders.list()` facade,
  emitted from the spec's `x-sdk-name` annotations. Each method's types
  come from indexed access on `paths` — zero duplicated shapes.

Discipline that keeps the chain honest:

- **Commit the generated files** so a fresh checkout typechecks without
  running the generator.
- **Regenerating is mandatory after any route or schema change** — make it
  reflex, and add a parity check to the test gate that fails when the
  committed snapshot no longer matches the live app's spec. Drift becomes
  a red gate, not a runtime surprise.
- Generated files open with a loud `GENERATED — DO NOT EDIT` header naming
  the regen command.

## 3. The runtime client — one factory, two surfaces

The hand-written part of the SDK is tiny: a factory that wraps
[`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) with the generated
`paths` type and composes the namespaced facade onto the same instance:

```ts
export function createAppClient(options: { baseUrl: string }) {
  const client = createClient<paths>({ baseUrl: options.baseUrl })
  return Object.assign(client, makeNamespaced(client))
}
```

- **Path-keyed surface** — `client.GET('/orders', …)` returns
  `{ data, error }`; useful for odd cases.
- **Namespaced surface** — `client.orders.list()` returns the body
  directly and throws a typed `SdkError` on any non-2xx, carrying the
  status and response body. Apps use this one; error handling lives in
  one error class, not scattered status checks.
- Both surfaces share one fetch and one config. Auth, when it arrives,
  is a factory option (`getAuthToken`, `onUnauthorized`) — one home,
  every consumer covered.

## 4. Connecting the SDK to the UI

The UI never calls `fetch` and never builds a URL. Three layers, each with
one job:

- **One client instance for the whole app.** Create it once at boot and
  provide it (Vue: an `InjectionKey` + `app.provide`; React: a context).
  In dev, `baseUrl: '/api'` rides the dev-server proxy to the API process —
  the browser never needs CORS.
- **One composable/hook per read or mutation**, colocated per feature,
  wrapping the SDK call in TanStack Query with a per-feature key factory:

```ts
export function useOrders() {
  const client = useAppClient()
  return useQuery({
    queryKey: orderKeys.list(),
    queryFn: async () => (await client.orders.list()).orders,
  })
}
```

  Mutations invalidate their feature's keys on success, so every screen
  refreshes itself — no manual refetch plumbing in components.
- **Components consume composables only.** A component never imports the
  SDK directly; it renders query state (`data`, `isPending`, `isError`)
  and calls mutations. That keeps every network concern swappable and
  every component testable with a stubbed client.

## 5. Connecting any other app

Every other consumer uses the SAME factory — never a second client:

- **Worker / CLI / scripts:** `createAppClient({ baseUrl: 'http://…' })`
  pointed at the running API.
- **Component tests:** stub the client shape (`{ orders: { list: async
  () => … } }`) and inject it — tests exercise the real composables and
  components with no network at all.
- **A future public SDK** is the same package published — which is why no
  app-specific assumption (proxy paths, auth shortcuts) may leak into the
  factory; those stay options.

## 6. The order of work when adding an endpoint

1. Core operation in the feature package (with its tests).
2. Route: zod validators + `describeRoute` + `x-sdk-name`.
3. `pnpm api:generate` — spec, types, and facade update together.
4. The composable/hook wrapping the new SDK method.
5. The screen consuming the composable.
6. Gate green, then commit — one vertical slice, every layer typed against
   the one below it.
