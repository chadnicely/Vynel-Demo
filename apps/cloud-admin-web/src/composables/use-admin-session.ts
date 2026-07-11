import { computed } from "vue";
import { useQueryClient, type QueryClient } from "@tanstack/vue-query";
import type { HubSessionResponse } from "@vynel/contracts/hub/hub-auth";
import { adminApiFetch } from "../lib/admin-api.js";
import {
  adminAccessForbidden,
  adminSession,
  clearAdminSession,
  storeAdminSession,
} from "../lib/admin-session-state.js";

/** The signed-in admin's session — module-scoped state (one browser session,
 *  one admin), read through a composable so views stay reactive. */
export function useAdminSession() {
  const queryClient = useQueryClient();
  return {
    session: computed(() => adminSession.value),
    isSignedIn: computed(() => adminSession.value !== null),
    isForbidden: computed(() => adminAccessForbidden.value),
    signIn,
    signOut: () => signOut(queryClient),
  };
}

async function signIn(email: string, password: string): Promise<void> {
  const session = await adminApiFetch<HubSessionResponse>("/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      // Auth is the generic hub surface — it wants a device row even for a
      // browser portal; the fixed description keeps the device list readable.
      device: {
        deviceName: "Admin portal",
        devicePlatform: "web",
        appVersion: "0.0.0",
      },
    }),
  });
  storeAdminSession({
    accessToken: session.accessToken,
    email: session.email,
    displayName: session.displayName,
  });
}

function signOut(queryClient: QueryClient): void {
  // Local clear only: the portal never keeps the refresh token, and the
  // access token expires on its own.
  clearAdminSession();
  // The cached catalog goes with the session — the next account on this tab
  // must not flash the previous account's data.
  queryClient.clear();
}
