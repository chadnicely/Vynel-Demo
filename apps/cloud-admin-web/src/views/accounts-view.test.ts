import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { HubAdminAccount } from "@vynel/contracts/hub/admin";
import AccountsView from "./AccountsView.vue";
import { createAppRouter } from "../router.js";
import {
  clearAdminSession,
  storeAdminSession,
} from "../lib/admin-session-state.js";

function makeAccount(overrides: Partial<HubAdminAccount>): HubAdminAccount {
  return {
    id: "acct-1",
    email: "chad@vynel.dev",
    displayName: "Chad",
    role: "admin",
    tier: "pro",
    tierExpiresAt: null,
    status: "active",
    createdAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

/** fetch double: GET /admin/accounts answers `accounts`; everything else 200s
 *  with an empty body — the mutations under test only need the call log. */
function stubAccountsFetch(accounts: HubAdminAccount[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/accounts" && (init?.method ?? "GET") === "GET") {
      return { ok: true, status: 200, json: async () => ({ accounts }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountAccounts() {
  const router = createAppRouter();
  await router.push("/accounts");
  await router.isReady();
  const wrapper = mount(AccountsView, {
    global: {
      plugins: [
        router,
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
              },
            }),
          },
        ],
      ],
    },
  });
  await flushPromises();
  return wrapper;
}

function findRow(
  wrapper: Awaited<ReturnType<typeof mountAccounts>>,
  email: string,
) {
  return wrapper
    .findAll("tbody tr")
    .find((row) => row.text().includes(email))!;
}

describe("AccountsView", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearAdminSession();
    storeAdminSession({
      accessToken: "access-token-1",
      email: "admin@vynel.dev",
      displayName: "Ada Admin",
    });
    vi.unstubAllGlobals();
  });

  it("renders the management table from GET /admin/accounts with the bearer", async () => {
    const fetchMock = stubAccountsFetch([
      makeAccount({}),
      makeAccount({
        id: "acct-2",
        email: "member@vynel.dev",
        displayName: "Member",
        role: "member",
        tier: "basic",
        status: "disabled",
      }),
    ]);

    const wrapper = await mountAccounts();

    expect(wrapper.text()).toContain("chad@vynel.dev");
    expect(wrapper.text()).toContain("member@vynel.dev");
    expect(wrapper.text()).toContain("disabled");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/admin/accounts");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer access-token-1",
    );
  });

  it("changes role and tier straight from the row selects", async () => {
    const fetchMock = stubAccountsFetch([makeAccount({})]);
    const wrapper = await mountAccounts();
    const row = findRow(wrapper, "chad@vynel.dev");

    await row.find('select[aria-label="Role for chad@vynel.dev"]').setValue("member");
    await flushPromises();
    await row.find('select[aria-label="Tier for chad@vynel.dev"]').setValue("basic");
    await flushPromises();

    const posts = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    ) as unknown as [string, RequestInit][];
    expect(posts.map(([url]) => url)).toEqual([
      "/api/admin/accounts/acct-1/role",
      "/api/admin/accounts/acct-1/tier",
    ]);
    expect(JSON.parse(posts[0]![1].body as string)).toEqual({
      role: "member",
    });
    expect(JSON.parse(posts[1]![1].body as string)).toEqual({
      tier: "basic",
      tierExpiresAt: null,
    });
  });

  it("disables only after the two-step confirm; cancel backs out", async () => {
    const fetchMock = stubAccountsFetch([makeAccount({})]);
    const wrapper = await mountAccounts();
    const row = findRow(wrapper, "chad@vynel.dev");

    const disableButton = row
      .findAll("button")
      .find((button) => button.text() === "Disable")!;
    await disableButton.trigger("click");
    // Armed, not fired: the row now asks for confirmation.
    expect(row.text()).toContain("Confirm disable");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url as string).endsWith("/status"),
      ),
    ).toBe(false);

    // Cancel backs out without a request.
    await row
      .findAll("button")
      .find((button) => button.text() === "Cancel")!
      .trigger("click");
    expect(row.text()).not.toContain("Confirm disable");

    // Arm again and confirm — NOW the status POST goes out.
    await row
      .findAll("button")
      .find((button) => button.text() === "Disable")!
      .trigger("click");
    await row
      .findAll("button")
      .find((button) => button.text() === "Confirm disable")!
      .trigger("click");
    await flushPromises();

    const statusCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith("/status"),
    ) as unknown as [string, RequestInit];
    expect(statusCall[0]).toBe("/api/admin/accounts/acct-1/status");
    expect(JSON.parse(statusCall[1].body as string)).toEqual({
      status: "disabled",
    });
  });
});
