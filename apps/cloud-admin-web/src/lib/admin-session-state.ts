import { ref } from "vue";

// The one home for the signed-in admin's client state. Both the fetch layer
// (lib/admin-api.ts) and the session composable read/write it — a separate
// module keeps that pair cycle-free.

export interface AdminSession {
  readonly accessToken: string;
  readonly email: string;
  readonly displayName: string;
}

const STORAGE_KEY = "vynel-admin-session";

function readStoredSession(): AdminSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AdminSession>;
    if (
      typeof parsed.accessToken === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.displayName === "string"
    ) {
      return {
        accessToken: parsed.accessToken,
        email: parsed.email,
        displayName: parsed.displayName,
      };
    }
  } catch {
    // A corrupt stored value is just a signed-out state.
  }
  sessionStorage.removeItem(STORAGE_KEY);
  return null;
}

export const adminSession = ref<AdminSession | null>(readStoredSession());

/** Flipped by the fetch layer when an /admin call answers 403: the account is
 *  signed in but not an admin — the shell swaps to the full-page card. */
export const adminAccessForbidden = ref(false);

export function storeAdminSession(session: AdminSession): void {
  adminSession.value = session;
  adminAccessForbidden.value = false;
  // sessionStorage ONLY: an admin tool holds short-lived credentials per
  // browser session; refresh-token persistence is deliberate non-scope until
  // the portal ships hub-served.
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearAdminSession(): void {
  adminSession.value = null;
  adminAccessForbidden.value = false;
  sessionStorage.removeItem(STORAGE_KEY);
}
