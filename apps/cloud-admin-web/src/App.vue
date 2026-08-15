<script setup lang="ts">
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { LibraryBig, LogOut, SlidersHorizontal, Users } from "lucide-vue-next";
import NotAdminCard from "./components/NotAdminCard.vue";
import { useAdminSession } from "./composables/use-admin-session.js";

const route = useRoute();
const router = useRouter();
const { session, isSignedIn, isForbidden, signOut } = useAdminSession();

// The fetch layer clears the session on any 401 — this watcher is the
// redirect half of that contract (sign-out lands here too).
watch(isSignedIn, (signedIn) => {
  if (!signedIn) void router.replace({ name: "sign-in" });
});

function handleSignOut() {
  signOut();
}
</script>

<template>
  <RouterView v-if="route.meta.bare" />
  <NotAdminCard v-else-if="isForbidden" @sign-out="handleSignOut" />
  <div v-else class="admin-shell">
    <aside class="admin-nav">
      <div class="brand">Vynel Hub Admin</div>
      <nav>
        <RouterLink class="nav-link" :to="{ name: 'catalog' }">
          <LibraryBig :size="16" />
          <span>Catalog</span>
        </RouterLink>
        <RouterLink class="nav-link" :to="{ name: 'accounts' }">
          <Users :size="16" />
          <span>Accounts</span>
        </RouterLink>
        <RouterLink class="nav-link" :to="{ name: 'tool-policy' }">
          <SlidersHorizontal :size="16" />
          <span>Tool policy</span>
        </RouterLink>
      </nav>
    </aside>
    <div class="admin-main">
      <header class="admin-header">
        <span class="signed-in-as">{{ session?.email }}</span>
        <button type="button" class="button sign-out" @click="handleSignOut">
          <LogOut :size="14" />
          <span>Sign out</span>
        </button>
      </header>
      <main class="admin-body">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-shell {
  display: grid;
  grid-template-columns: 200px 1fr;
  height: 100vh;
  background: var(--bg-shell);
  color: var(--ink-1);
}

.admin-nav {
  border-right: 1px solid var(--hair);
  background: var(--bg-panel);
  padding: 16px 10px;
}

.brand {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
  padding: 0 8px 16px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--radius-s);
  color: var(--ink-2);
  text-decoration: none;
  margin-bottom: 2px;
}

.nav-link:hover {
  background: var(--row-hover);
}

.nav-link.router-link-active {
  background: var(--row-active);
  color: var(--ink-1);
}

.admin-main {
  display: grid;
  grid-template-rows: 48px 1fr;
  min-width: 0;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 0 20px;
  border-bottom: 1px solid var(--hair);
}

.signed-in-as {
  color: var(--ink-2);
  font-size: 12.5px;
}

.sign-out {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
}

.admin-body {
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}
</style>
