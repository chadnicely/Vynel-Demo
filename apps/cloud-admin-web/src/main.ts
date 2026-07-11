import { createApp } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import "./styles/tokens.css";
import "./styles/app.css";
import App from "./App.vue";
import { createAppRouter } from "./router.js";

const app = createApp(App);

app.use(createAppRouter());

// One QueryClient for the portal: server state lives in vue-query; a thin
// admin surface has no client state worth a store.
app.use(VueQueryPlugin, {
  queryClient: new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  }),
});

app.mount("#app");
