import {
  adminAccessForbidden,
  adminSession,
  clearAdminSession,
} from "./admin-session-state.js";

/** A hub error answer (`{code, message}` JSON) as a throwable. */
export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

/**
 * The portal's one fetch home: injects the bearer, parses `{code, message}`
 * errors, and routes the two shell-level statuses (401 → session cleared so
 * the shell redirects to sign-in; 403 → the not-an-admin card).
 *
 * Paths are hub-relative (`/auth/...`, `/admin/...`) — every request goes out
 * as `/api/...` because the future hub-served prod mode mounts the same /api
 * strip the dev proxy does (the gateway precedent: dev == prod paths).
 */
export async function adminApiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const token = adminSession.value?.accessToken ?? null;
  if (token !== null) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401 && token !== null) clearAdminSession();
    if (response.status === 403) adminAccessForbidden.value = true;
    throw await toAdminApiError(response);
  }
  return (await response.json()) as T;
}

async function toAdminApiError(response: Response): Promise<AdminApiError> {
  try {
    const body = (await response.json()) as {
      code?: unknown;
      message?: unknown;
    };
    if (typeof body.code === "string" && typeof body.message === "string") {
      return new AdminApiError(body.code, body.message, response.status);
    }
  } catch {
    // Non-JSON error bodies fall through to the generic message.
  }
  return new AdminApiError(
    "unknown",
    `The hub answered ${response.status} — check that cloud-api is running and try again.`,
    response.status,
  );
}
