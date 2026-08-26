// The 13-screen wizard, driven end to end: the folder picked first, answers
// in, the AI-synthesized plan on screen (or the mechanical one when the AI
// can't), the rating loop banking change requests, Finish making the
// workspace for real, and "Open my workspace" handing the shell the stored
// brief. The engine is a fake client — these tests prove the wiring, not
// the model.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import type { DirectoryListingResponse } from "@vynel/contracts/workspaces/workspace-http";
import { vynelClientKey } from "../../../plugins/vynel-client.js";
import WorkspaceWizard from "./WorkspaceWizard.vue";

const GIB = 1024 ** 3;
const PROJECTS = "C:\\Users\\chad\\Projects";

type FakeCalls = {
  studyRival: unknown[];
  synthesizePlan: unknown[];
  scaffold: unknown[];
  createGitHubRepository: unknown[];
};

const STORED_BRIEF =
  "Build Front of House — the MVP first.\n\nThe idea: from the server.";

// The folder picker's fake tree: home (C:\Users\chad) → Projects.
function makeListings(): Record<string, DirectoryListingResponse> {
  const rails = {
    drives: [
      {
        path: "C:\\",
        label: null,
        kind: "fixed" as const,
        freeBytes: 51 * GIB,
        totalBytes: 399 * GIB,
      },
    ],
    places: [{ kind: "home" as const, name: "chad", path: "C:\\Users\\chad" }],
  };
  return {
    "C:\\Users\\chad": {
      path: "C:\\Users\\chad",
      parent: "C:\\Users",
      entries: [{ name: "Projects", path: PROJECTS }],
      ...rails,
    },
    [PROJECTS]: {
      path: PROJECTS,
      parent: "C:\\Users\\chad",
      entries: [],
      ...rails,
    },
  };
}

function makeFakeClient(
  options: {
    planIsNull?: boolean;
    signedIn?: boolean;
    githubSignedIn?: boolean;
  } = {},
) {
  const calls: FakeCalls = {
    studyRival: [],
    synthesizePlan: [],
    scaffold: [],
    createGitHubRepository: [],
  };
  const listings = makeListings();
  const client = {
    github: {
      getConnection: async () => ({
        isInstalled: true,
        isAuthenticated: options.githubSignedIn ?? false,
        accountLabel: options.githubSignedIn ? "chadnicely" : null,
        inactiveReason: options.githubSignedIn ? null : "Not signed in",
      }),
    },
    providers: {
      getAuthStatus: async () => ({
        providerId: "claude",
        isInstalled: true,
        isAuthenticated: options.signedIn ?? true,
        authenticatedAccountLabel: "chad@x.dev",
        authenticationMethod: "oauth",
        inactiveReason: null,
        email: "chad@x.dev",
        organizationName: "Chad's Organization",
        subscriptionPlan: "max",
      }),
    },
    workspaces: {
      listDirectories: async (query?: { path?: string }) => {
        const listing = listings[query?.path ?? "C:\\Users\\chad"];
        if (!listing) throw new Error(`${query?.path} is not readable.`);
        return structuredClone(listing);
      },
      studyRival: async (input: unknown) => {
        calls.studyRival.push(input);
        return {
          study: {
            whatTheyDo: [
              "A search box at the top of every page",
              "Email confirmation",
            ],
            leaveOut: [
              "The sales pitch — your people already know who you are",
            ],
            magic: [
              { title: "Done in one screen", why: "Pick, confirm, finished." },
            ],
          },
        };
      },
      synthesizePlan: async (input: unknown) => {
        calls.synthesizePlan.push(input);
        if (options.planIsNull) return { plan: null };
        return {
          plan: {
            oneLine: "A website where your customers can book a table.",
            build: [
              { text: "Let people book a table", source: "your answers" },
            ],
            remembers: ["Bookings"],
            leftOut: ["The sales pitch"],
            mvpNutshell: "The smallest version worth using.",
            goals: [
              {
                title: "Somewhere your people can book",
                bullets: ["One screen"],
              },
            ],
            sessions: [
              {
                name: "Set the project up",
                items: ["The first page"],
                mvp: true,
              },
              {
                name: "The front page",
                items: ["What people see first"],
                mvp: true,
              },
              { name: "Photos", items: ["Drag one in"], mvp: false },
            ],
          },
        };
      },
      createGitHubRepository: async (
        workspaceId: string,
        input: { name: string; visibility: string },
      ) => {
        calls.createGitHubRepository.push({ workspaceId, ...input });
        return {
          outcome: {
            kind: "created",
            url: `https://github.com/chadnicely/${input.name}`,
          },
        };
      },
      // The engine mints the folder from the name inside the user's workspace
      // folder — the client sends no directory and is told the path after.
      scaffold: async (input: { name: string }) => {
        calls.scaffold.push(input);
        return {
          workspace: {
            id: "ws-new",
            userId: "user-1",
            name: input.name,
            managerName: input.name,
            kind: "personal",
            path: `${PROJECTS}\\${input.name}`,
            isArchived: false,
            continueEnabled: true,
            groupId: null,
            status: null,
            statusNote: null,
            statusSetAt: null,
            createdAt: "",
            updatedAt: "",
            lastAccessedAt: "",
          },
          git: { kind: "initialized" },
          brief: {
            workspaceId: "ws-new",
            answers: {},
            plan: {},
            brief: STORED_BRIEF,
            createdAt: "2026-08-23T10:00:00.000Z",
          },
        };
      },
    },
  } as unknown as VynelClient;
  return { client, calls };
}

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
});

function queryPlugin(): [typeof VueQueryPlugin, { queryClient: QueryClient }] {
  return [
    VueQueryPlugin,
    {
      queryClient: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
  ];
}

async function mountWizard(
  options: {
    planIsNull?: boolean;
    signedIn?: boolean;
    githubSignedIn?: boolean;
    groupId?: string;
  } = {},
) {
  const fake = makeFakeClient(options);
  const wrapper = mount(WorkspaceWizard, {
    props: { open: true, groupId: options.groupId ?? null },
    global: {
      plugins: [queryPlugin()],
      provide: { [vynelClientKey as symbol]: fake.client },
    },
  });
  await flushPromises();
  activeWrapper = wrapper;
  return { wrapper, ...fake };
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function findButton(text: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
  if (!match) throw new Error(`no button containing "${text}"`);
  return match as HTMLButtonElement;
}

async function press(text: string) {
  findButton(text).click();
  await flushPromises();
}

async function type(selector: string, value: string) {
  const field = document.body.querySelector(selector) as
    HTMLInputElement | HTMLTextAreaElement;
  if (!field) throw new Error(`no field ${selector}`);
  field.value = value;
  field.dispatchEvent(new Event("input"));
  await flushPromises();
}

function tile(name: string): HTMLButtonElement {
  const match = [
    ...document.body.querySelectorAll<HTMLButtonElement>("button.fs-tile"),
  ].find((button) => button.textContent?.trim() === name);
  if (!match) throw new Error(`no folder tile "${name}"`);
  return match;
}

/** The naming screen — screen 9 now, not screen 1 (Chad's order, restored
 *  2026-08-24). Just a name: there is no folder to pick, the engine mints one. */
async function pickPlace(name = "Front of House") {
  await type("input[type='text']", name);
}

/** Screen 9 → 10: name it, then on to the account pre-flight. */
async function nameItAndContinue(name = "Front of House") {
  await pickPlace(name);
  await press("Continue");
}

/** Screens 1–3, landing on the rivals screen. The IDEA opens the wizard. */
async function answerThroughQuestions() {
  await type(
    "textarea",
    "A place where my regulars can book a table and see the week.",
  );
  await press("Continue");
  await press("My customers");
  await type(
    "input[placeholder='Book a table for a date and time']",
    "Book a table for a date and time",
  );
  await press("No, open to everyone");
  await press("Continue");
  await press("A website");
  await press("Bookings");
  await press("Continue");
}

/** A wizard whose synthesizePlan calls stay open until the test resolves
 *  them — the only way to exercise the slow-model races. `makePlan` writes
 *  the marker into every text the current screen might show. */
async function mountWithDeferredSynthesis() {
  const pending: Array<{ input: unknown; resolve: (plan: unknown) => void }> =
    [];
  const makePlan = (marker: string) => ({
    oneLine: marker,
    build: [{ text: marker, source: "your answers" }],
    remembers: ["Bookings"],
    leftOut: [],
    mvpNutshell: marker,
    goals: [{ title: marker, bullets: [marker] }],
    sessions: [{ name: marker, items: [marker], mvp: true }],
  });
  const base = makeFakeClient().client as unknown as {
    workspaces: Record<string, unknown>;
  };
  const client = {
    ...base,
    workspaces: {
      ...base.workspaces,
      studyRival: async () => ({ study: null }),
      synthesizePlan: (input: unknown) =>
        new Promise((resolve) =>
          pending.push({ input, resolve: (plan) => resolve({ plan }) }),
        ),
    },
  } as unknown as VynelClient;
  const wrapper = mount(WorkspaceWizard, {
    props: { open: true, groupId: null },
    global: {
      plugins: [queryPlugin()],
      provide: { [vynelClientKey as symbol]: client },
    },
  });
  await flushPromises();
  activeWrapper = wrapper;
  return { wrapper, pending, makePlan };
}

describe("WorkspaceWizard", () => {
  // Chad's order, restored 2026-08-24: the IDEA opens the wizard. Kafi had put
  // the folder first because every AI read dispatched from it — neither the
  // folder question nor that constraint exists any more.
  it("opens on the IDEA, and never shows a folder or a path anywhere", async () => {
    await mountWizard();
    expect(bodyText()).toContain("What do you want to build?");
    expect(bodyText()).toContain("Step 1 of 12");
    expect(findButton("Continue").disabled).toBe(true);

    // Picking a folder was the hardest thing this wizard asked of a
    // non-technical person, so it is gone from every screen.
    expect(document.body.querySelector("button.fs-tile")).toBeNull();
    expect(bodyText()).not.toContain(PROJECTS);

    await type(
      "textarea",
      "A place where my regulars can book a table and see the week.",
    );
    expect(findButton("Continue").disabled).toBe(false);

    await press("Continue");
    expect(bodyText()).toContain("Step 2 of 12");
  });

  it("names it late — screen 9, after the plan is agreed", async () => {
    await mountWizard();
    await answerThroughQuestions();
    await press("Continue"); // rivals
    await press("Continue"); // wants
    await press("10"); // plan
    await press("Looks right");
    await press("Yes, that is it"); // goals
    await press("Continue");
    await press("Continue"); // stack → place

    expect(bodyText()).toContain("What are we building?");
    expect(bodyText()).toContain("Step 9 of 12");
    expect(bodyText()).toContain("Give it a name to continue");
    // Still no folder, and no path, on the screen that names it.
    expect(document.body.querySelector("button.fs-tile")).toBeNull();
    expect(bodyText()).not.toContain(PROJECTS);

    await pickPlace();
    expect(findButton("Continue").disabled).toBe(false);
  });

  it("walks the questions with a talking gate at each", async () => {
    await mountWizard();
    await answerThroughQuestions();
    expect(bodyText()).toContain("Is there one like it already?");
    expect(bodyText()).toContain("Step 4 of 12");
  });

  it("studies a rival site, labels it as model knowledge, and ticks feed the wish list", async () => {
    const { calls } = await mountWizard();
    await answerThroughQuestions();

    await type("input", "https://OpenTable.com/");
    expect(findButton("Look into it")).toBeTruthy();
    await press("Look into it");

    expect(calls.studyRival).toEqual([
      expect.objectContaining({ site: "opentable.com" }),
    ]);
    expect(bodyText()).toContain(
      "From what Claude already knows of opentable.com",
    );
    expect(bodyText()).toContain("What they do");
    expect(bodyText()).toContain("What would make yours magical");

    await press("A search box at the top of every page");
    await press("Done in one screen");
    expect(bodyText()).toContain("2 ticked here");

    await press("Continue");
    expect(bodyText()).toContain("Everything you liked, in one place");
    expect(bodyText()).toContain("From opentable.com");
  });

  it("the plan screen shows the synthesis; under 10 the changes loop banks the note and re-synthesizes", async () => {
    const { calls } = await mountWizard();
    await answerThroughQuestions();
    await press("Continue"); // rivals (none)
    await press("Continue"); // wants

    expect(bodyText()).toContain("The whole plan");
    expect(calls.synthesizePlan).toHaveLength(1);
    expect(calls.synthesizePlan[0]).toEqual(
      expect.objectContaining({
        audience: "My customers",
      }),
    );
    expect(bodyText()).toContain(
      "A website where your customers can book a table.",
    );

    await press("6");
    expect(bodyText()).toContain("What would make it a 10?");
    await type("textarea", "Nobody should have to sign in just to look.");
    await press("Update the plan");

    expect(calls.synthesizePlan).toHaveLength(2);
    expect(calls.synthesizePlan[1]).toEqual(
      expect.objectContaining({
        changeRequests: ["Nobody should have to sign in just to look."],
      }),
    );
    expect(bodyText()).toContain("And what you asked us to change");

    await press("10");
    expect(bodyText()).toContain("Then we won't touch a thing.");
  });

  it("falls back to the mechanical plan when the synthesis is null — never an empty screen", async () => {
    await mountWizard({ planIsNull: true });
    await answerThroughQuestions();
    await press("Continue");
    await press("Continue");

    expect(bodyText()).toContain("The whole plan");
    expect(bodyText()).toContain("Let people book a table for a date and time");
    expect(bodyText()).toContain("your answers");
  });

  it("a slow synthesis never lands over a banked change request", async () => {
    const { pending, makePlan } = await mountWithDeferredSynthesis();

    await answerThroughQuestions();
    await press("Continue"); // rivals
    await press("Continue"); // wants → plan; synthesis 1 in flight
    expect(pending).toHaveLength(1);

    await press("6");
    await type("textarea", "Nobody should have to sign in just to look.");
    await press("Update the plan"); // banks the note; synthesis 2 fires
    expect(pending).toHaveLength(2);

    // The PRE-change reply lands late — it must not be shown as current.
    pending[0]!.resolve(makePlan("THE STALE PLAN"));
    await flushPromises();
    expect(bodyText()).not.toContain("THE STALE PLAN");

    // The post-change reply is the one that lands.
    pending[1]!.resolve(makePlan("The plan with your change folded in."));
    await flushPromises();
    expect(bodyText()).toContain("The plan with your change folded in.");
    expect(pending[1]!.input).toEqual(
      expect.objectContaining({
        changeRequests: ["Nobody should have to sign in just to look."],
      }),
    );
  });

  it("a reply landing after the user moved past the goals screen never swaps the rated plan", async () => {
    const { pending, makePlan } = await mountWithDeferredSynthesis();

    await answerThroughQuestions();
    await press("Continue"); // rivals
    await press("Continue"); // wants → plan; synthesis in flight, fallback shown
    expect(bodyText()).toContain(
      "A website where your customers can book a table for a date and time.",
    );

    await press("10"); // the user rates the MECHANICAL plan a 10
    await press("Looks right");
    await press("Yes, that is it");
    await press("Continue"); // → stack, past the goals screen

    pending.shift()!.resolve(makePlan("A PLAN FROM AFTER APPROVAL"));
    await flushPromises();
    await press("Back"); // → goals: still the plan that was rated
    expect(bodyText()).not.toContain("A PLAN FROM AFTER APPROVAL");
    expect(bodyText()).toContain("Nothing you ticked has been dropped");
  });

  it("the account step is a global pre-flight: signed out gates with the sign-in door, signed in passes", async () => {
    const { wrapper } = await mountWizard({ signedIn: false });
    await answerThroughQuestions();
    await press("Continue"); // rivals
    await press("Continue"); // wants
    await press("10");
    await press("Looks right");
    await press("Yes, that is it");
    await press("Continue"); // goals → stack
    await press("Continue"); // stack → place
    await nameItAndContinue(); // place → account

    expect(bodyText()).toContain("The account that builds");
    expect(bodyText()).toContain("Claude — not signed in");
    expect(bodyText()).toContain("Sign in to Claude to continue");
    expect(findButton("Continue").disabled).toBe(true);
    expect(bodyText()).toContain("GitHub — not connected");

    await press("Sign in");
    expect(wrapper.emitted("signIn")).toHaveLength(1);
  });

  it("a site that cannot be studied says so on screen; a Finish that fails says why and stays", async () => {
    const fake = makeFakeClient();
    const client = fake.client as unknown as {
      workspaces: Record<string, unknown>;
    };
    client.workspaces.studyRival = async () => ({ study: null });
    client.workspaces.scaffold = async () => {
      throw new Error(
        'A folder named "Front of House" is already here. Pick another name.',
      );
    };
    const wrapper = mount(WorkspaceWizard, {
      props: { open: true, groupId: null },
      global: {
        plugins: [queryPlugin()],
        provide: { [vynelClientKey as symbol]: fake.client },
      },
    });
    await flushPromises();
    activeWrapper = wrapper;

    await answerThroughQuestions();
    await type("input", "opentable.com");
    await press("Look into it");
    expect(bodyText()).toContain(
      "We couldn't put together what opentable.com does just now",
    );

    await press("Continue"); // rivals
    await press("Continue"); // wants
    await press("10");
    await press("Looks right");
    await press("Yes, that is it");
    await press("Continue"); // goals → stack
    await press("Continue"); // stack → place
    await nameItAndContinue(); // place → account
    await press("Continue"); // account → care
    await press("Continue"); // care → sessions
    await press("I approve the plan");
    await press("Finish");

    expect(
      document.body.querySelector("[role='alert']")?.textContent,
    ).toContain('A folder named "Front of House" is already here');
    expect(bodyText()).toContain("How we will build it");
    expect(wrapper.emitted("created")).toBeUndefined();
  });

  it("Finish makes the workspace, Done reports honestly, Open my workspace hands over the STORED brief", async () => {
    const { wrapper, calls } = await mountWizard({
      groupId: "grp-1",
      githubSignedIn: true,
    });
    await answerThroughQuestions();
    await press("Continue"); // rivals
    await press("Continue"); // wants
    await press("10"); // plan
    await press("Looks right");
    await press("Yes, that is it"); // goals
    await press("Continue");
    expect(bodyText()).toContain("What we will build it with");
    await press("Continue"); // stack → place
    // Naming comes here now (screen 9), not at the very start.
    expect(bodyText()).toContain("What are we building?");
    await nameItAndContinue(); // place → account
    expect(bodyText()).toContain("Claude — signed in");
    expect(bodyText()).toContain("chad@x.dev");
    expect(bodyText()).toContain("GitHub — signed in as @chadnicely");
    // The repository offer: on by default, its name following the workspace.
    expect(bodyText()).toContain("Also create the repository on GitHub");
    expect(
      (
        document.querySelector(
          'input[placeholder="my-workspace"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("front-of-house");
    await press("Continue"); // account
    expect(bodyText()).toContain("You don't need to be a security expert.");
    await press("Continue"); // care
    expect(bodyText()).toContain("How we will build it");
    expect(bodyText()).toContain("2 sessions in the MVP");

    await press("I approve the plan");
    await press("Finish");

    expect(calls.scaffold).toEqual([
      expect.objectContaining({
        name: "Front of House",
        groupId: "grp-1",
        answers: expect.objectContaining({
          idea: "A place where my regulars can book a table and see the week.",
          audience: "My customers",
          stack: expect.objectContaining({ front: "Nuxt.js" }),
        }),
        plan: expect.objectContaining({
          oneLine: "A website where your customers can book a table.",
        }),
      }),
    ]);
    expect(bodyText()).toContain("What happens from here");
    expect(bodyText()).toContain(PROJECTS);
    expect(bodyText()).toContain("first commit in");
    // The repository was made AFTER the scaffold, for the new workspace, and
    // Done links to it.
    expect(calls.createGitHubRepository).toEqual([
      { workspaceId: "ws-new", name: "front-of-house", visibility: "private" },
    ]);
    expect(bodyText()).toContain(
      "https://github.com/chadnicely/front-of-house",
    );

    await press("Open my workspace");
    const emitted = wrapper.emitted("created");
    expect(emitted).toHaveLength(1);
    const payload = emitted![0]![0] as {
      workspace: { id: string };
      brief: string;
    };
    expect(payload.workspace.id).toBe("ws-new");
    expect(payload.brief).toBe(STORED_BRIEF);
  });

  it("a repository gh could not make is a reported outcome on Done — the workspace is still handed over", async () => {
    const { wrapper, calls, client } = await mountWizard({
      githubSignedIn: true,
    });
    (
      client as unknown as { workspaces: Record<string, unknown> }
    ).workspaces.createGitHubRepository = async () => ({
      outcome: {
        kind: "failed",
        reason: "Name already exists on this account.",
      },
    });
    await answerThroughQuestions();
    await press("Continue"); // rivals
    await press("Continue"); // wants
    await press("10");
    await press("Looks right");
    await press("Yes, that is it");
    await press("Continue"); // goals → stack
    await press("Continue"); // stack → place
    await nameItAndContinue(); // place → account
    await press("Continue"); // account → care
    await press("Continue"); // care → sessions
    await press("I approve the plan");
    await press("Finish");

    expect(calls.scaffold).toHaveLength(1);
    expect(bodyText()).toContain(
      "The GitHub repository was not created: Name already exists on this account.",
    );
    expect(bodyText()).toContain("The workspace is fine");

    await press("Open my workspace");
    expect(wrapper.emitted("created")).toHaveLength(1);
  });

  it("Finish stays busy through the push — a second click never scaffolds the folder twice", async () => {
    const { calls, client } = await mountWizard({ githubSignedIn: true });
    let finishPush: (outcome: unknown) => void = () => {};
    (
      client as unknown as { workspaces: Record<string, unknown> }
    ).workspaces.createGitHubRepository = () =>
      new Promise((resolve) => {
        finishPush = (outcome) => resolve({ outcome });
      });
    await answerThroughQuestions();
    await press("Continue"); // rivals
    await press("Continue"); // wants
    await press("10");
    await press("Looks right");
    await press("Yes, that is it");
    await press("Continue"); // goals → stack
    await press("Continue"); // stack → place
    await nameItAndContinue(); // place → account
    await press("Continue"); // account → care
    await press("Continue"); // care → sessions
    await press("I approve the plan");
    await press("Finish");

    expect(calls.scaffold).toHaveLength(1);
    const busy = findButton("Pushing to GitHub…");
    expect(busy.disabled).toBe(true);
    busy.click();
    await flushPromises();
    expect(calls.scaffold).toHaveLength(1);

    finishPush({
      kind: "created",
      url: "https://github.com/chadnicely/front-of-house",
    });
    await flushPromises();
    expect(bodyText()).toContain("What happens from here");
    expect(bodyText()).toContain(
      "https://github.com/chadnicely/front-of-house",
    );
  });
});
