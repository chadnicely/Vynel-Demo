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
        // The floating Jarvis window (chrome --app). `bare` drops the app
        // shell — this view IS the whole window.
        path: "/jarvis",
        name: "jarvis",
        component: () => import("./views/JarvisView.vue"),
        meta: { bare: true },
      },
    ],
  });
}
