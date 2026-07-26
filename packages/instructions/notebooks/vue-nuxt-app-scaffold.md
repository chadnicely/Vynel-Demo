---
id: vue-nuxt-app-scaffold
title: Scaffolding a Vue or Nuxt frontend — shared UI and server state
oneLiner: Open this before building the frontend of a Node.js application — the Vue/Nuxt scaffold, the shared UI package, and the TanStack Query + Pinia state rules the product's own UI is built from.
---

# Scaffolding a Vue or Nuxt frontend — shared UI and server state

This is the frontend companion to **node-app-scaffold** (the backend shape)
and **node-sdk-from-api** (the typed client the UI calls through). It is how
this product's own UI is built; build the user's the same way.

**Vue 3 + Vite is the default** — a single-page app served next to the API.
Reach for **Nuxt** only when the app genuinely needs what it adds: server
rendering for SEO (public content pages), or file-based routing conventions
for a large page count. Everything below applies identically to both — Nuxt
changes where pages live, never how state and UI are layered.

## 1. The scaffold

The frontend is one thin app in the monorepo (`apps/web`), same citizenship
as the API:

```
apps/web/src/
  main.ts            ← boot: pinia → router → vue-query → provide SDK client
  router.ts
  plugins/           ← the query client + the SDK client factory
  components/<feature>/   ← screens' building blocks, grouped per feature
  composables/<feature>/  ← query/mutation hooks + key factories, per feature
  stores/            ← Pinia: UI state ONLY
  views/             ← route-level pages
  styles/
packages/ui/         ← the SHARED component library + design tokens
```

- TypeScript strict, `<script setup>` only — never the Options API.
- Boot order in `main.ts` is fixed: create Pinia, install the router,
  install `VueQueryPlugin` with ONE app-wide `QueryClient`, `provide` the
  SDK client under an `InjectionKey`, mount. Every layer below assumes
  these exist.
- In dev the app talks to the API through the dev-server proxy
  (`baseUrl: '/api'`) — no CORS, no hardcoded ports in app code.

## 2. The state law — two kinds, two homes, never mixed

Everything on screen is one of two kinds of state, and each has exactly one
home:

- **Server state** (anything fetched from the API) lives in **TanStack
  Query**. It is cache, not data you own: it refetches, goes stale, and
  invalidates. NEVER copy it into a Pinia store, a ref, or a prop chain
  "for convenience" — a copy is a bug factory that shows stale truth.
- **UI state** (open panels, selection, dialog visibility, draft input)
  lives in **Pinia** — one store per feature, small, no fetching inside
  stores, ever.

If a piece of state answers "what does the server say?", it's a query. If
it answers "what is the user looking at?", it's a store.

## 3. TanStack Query — the house patterns

- **One `QueryClient`** for the whole app, built in `plugins/`, with
  app-wide defaults (`staleTime` ~30s, `retry: 1`,
  `refetchOnWindowFocus: true`) so individual queries stay one-liners.
- Shell-level failures (session expired, first-run setup required) are
  handled ONCE — a global `onError` on the `QueryCache`/`MutationCache`
  that routes into the shell's store. No per-view handling of app-wide
  errors.
- **A key factory per feature**, next to its composables — string-building
  in components is banned:

```ts
export const orderKeys = {
  all: ["orders"] as const,
  list: () => [...orderKeys.all, "list"] as const,
  detail: (orderId: string) => [...orderKeys.all, "detail", orderId] as const,
};
```

- **One composable per read or mutation**, wrapping the SDK (never raw
  fetch). Mutations invalidate their feature's keys on success so every
  screen heals itself:

```ts
export function useCancelOrder() {
  const client = useAppClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => client.orders.cancel(orderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}
```

## 4. The shared UI package — `packages/ui`

Generic, reusable components live in one shared package, not scattered
through the app:

- **What belongs there:** design tokens (one `tokens.css` every app
  imports at boot), primitives (Modal, EmptyState, IconButton, markdown
  renderer), and components any second surface would need. Its `index.ts`
  is re-exports ONLY.
- **What stays in the app:** anything wired to a feature's composables or
  stores. `components/<feature>/` in the app is the default home; a
  component earns promotion to `packages/ui` when it is fully generic —
  props in, emits out, zero knowledge of the SDK or stores.
- The shared package never imports from apps and never fetches — it is
  leaves-down like every other package.
- One rendering path per concern: ONE markdown renderer (sanitized —
  never raw `v-html`), ONE modal, ONE confirm pattern. A second
  implementation of any of these is a bug, not a choice.

## 5. Component discipline

- Components consume composables and render their state (`data`,
  `isPending`, `isError`); they never import the SDK, never build URLs,
  never own server state.
- Props down, emits up. No parent-state mutation, no reach-around
  `$parent`, no prop drilling past two levels — reach for a store
  (UI state) or a query (server state) instead.
- Keep components small; when logic grows, extract a composable, not a
  bigger component. Every dialog/list/row that has behavior gets a
  colocated `*.test.ts` mounting it with a stubbed client shape — tests
  exercise real components with no network.
- Loading, empty, and error states are part of every screen's definition
  — an EmptyState with a next action beats a blank panel.

## 6. If Nuxt

Same architecture, three relocations:

- Pages move to `pages/` (file-based routing) and layouts to `layouts/` —
  `views/` and `router.ts` disappear.
- The plugins (`vue-query`, the SDK client) register via Nuxt plugins;
  server-rendered pages hydrate their queries with prefetched state.
- Rendering mode is a per-page decision: server-render the public,
  SEO-facing pages; keep the app's interior client-side. Don't pay SSR
  complexity where no crawler ever looks.

## 7. The order of work for a new screen

1. Composable(s): key factory entry + query/mutation wrapping the SDK.
2. The feature components consuming them, with their tests.
3. The view/page assembling the components; router entry.
4. Empty/loading/error states verified by walking the screen yourself.
5. Gate green, then commit — one vertical slice per screen.
