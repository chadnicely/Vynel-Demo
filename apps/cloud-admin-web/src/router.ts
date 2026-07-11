import { createRouter, createWebHistory } from "vue-router";
import { adminSession } from "./lib/admin-session-state.js";

export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", redirect: { name: "catalog" } },
      {
        // `bare` drops the app shell — sign-in is a lone card.
        path: "/sign-in",
        name: "sign-in",
        component: () => import("./views/SignInView.vue"),
        meta: { bare: true },
      },
      {
        path: "/catalog",
        name: "catalog",
        component: () => import("./views/CatalogView.vue"),
      },
      {
        // Registered before /catalog/:itemId so the intent reads plainly —
        // vue-router would rank the static segment first either way.
        path: "/catalog/publish",
        name: "catalog-publish",
        component: () => import("./views/PublishItemView.vue"),
      },
      {
        path: "/catalog/:itemId",
        name: "catalog-item",
        component: () => import("./views/CatalogItemView.vue"),
      },
      {
        path: "/accounts",
        name: "accounts",
        component: () => import("./views/AccountsView.vue"),
      },
    ],
  });

  router.beforeEach((to) => {
    if (to.name !== "sign-in" && adminSession.value === null) {
      return { name: "sign-in" };
    }
    return true;
  });

  return router;
}
