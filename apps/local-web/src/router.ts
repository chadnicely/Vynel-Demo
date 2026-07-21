import { createRouter, createWebHistory } from "vue-router";

// The three top-level places (titlebar tabs). Workspace gains a
// /workspace/:workspaceId child when workspace selection lands (M4).
export function createAppRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", redirect: { name: "home" } },
      {
        path: "/home",
        name: "home",
        component: () => import("./views/HomeView.vue"),
      },
      {
        path: "/chat",
        name: "chat",
        component: () => import("./views/GlobalChatView.vue"),
      },
      {
        path: "/workspace",
        name: "workspace",
        component: () => import("./views/WorkspaceView.vue"),
      },
      {
        // The session library (Home | Chat | Sessions). Scope rides the query:
        // `?workspace=<id>` lists that room's sessions; bare = everything.
        path: "/sessions",
        name: "sessions",
        component: () => import("./views/SessionsView.vue"),
      },
      {
        // The floating Jarvis window (chrome --app). `bare` drops the app
        // shell — this view IS the whole window.
        path: "/jarvis",
        name: "jarvis",
        component: () => import("./views/JarvisView.vue"),
        meta: { bare: true },
      },
      {
        // The desktop-control attention overlay (Tauri always-on-top window).
        // `bare` drops the app shell — the view mounts its own activity feed.
        path: "/desktop-control",
        name: "desktop-control",
        component: () => import("./views/DesktopControlOverlayView.vue"),
        meta: { bare: true },
      },
      {
        // Dev gallery for the reinvented desktop primitives (Tailwind + Reka UI).
        // `bare` renders it standalone, outside the shell + onboarding gate.
        path: "/ui-preview",
        name: "ui-preview",
        component: () => import("./views/PrimitivesPreview.vue"),
        meta: { bare: true },
      },
      {
        // Wave B scaffold — the reinvented shell on placeholder content, for
        // review before it replaces the real App.vue shell.
        path: "/shell-preview",
        name: "shell-preview",
        component: () => import("./views/ShellPreview.vue"),
        meta: { bare: true },
      },
    ],
  });
}
