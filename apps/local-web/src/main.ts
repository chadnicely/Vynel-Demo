import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import "@vynel/ui/styles/tokens.css";
import "./styles/app.css";
import App from "./App.vue";
import { createAppRouter } from "./router.js";
import { createAppQueryClient } from "./plugins/vue-query.js";
import {
  createLocalVynelClient,
  vynelClientKey,
} from "./plugins/vynel-client.js";
import { useOnboardingStore } from "./stores/onboarding-store.js";

const app = createApp(App);

const pinia = createPinia();
app.use(pinia);
app.use(createAppRouter());

// The query caches report the first-launch 412 here — outside any component,
// so the store instance must come from the explicit pinia handle.
const onboardingStore = useOnboardingStore(pinia);
app.use(VueQueryPlugin, {
  queryClient: createAppQueryClient({
    onOnboardingRequired: () => onboardingStore.markRequired(),
  }),
});
app.provide(vynelClientKey, createLocalVynelClient());

app.mount("#app");
