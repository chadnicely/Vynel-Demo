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

const app = createApp(App);

app.use(createPinia());
app.use(createAppRouter());
app.use(VueQueryPlugin, { queryClient: createAppQueryClient() });
app.provide(vynelClientKey, createLocalVynelClient());

app.mount("#app");
