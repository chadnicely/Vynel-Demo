// "Which project?" — one Choose folder button, then whatever Vynel found
// inside (Chad, 2026-08-24). The OS folder window is faked at the client seam;
// what these pin is the screen's three answers and that several projects land
// as several.

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { VynelClient } from "@vynel/sdk";
import { vynelClientKey } from "../../plugins/vynel-client.js";
import WhichProjectDialog from "./WhichProjectDialog.vue";

type Scan =
  | { kind: "single"; project: { path: string; name: string; foundBy: string } }
  | {
      kind: "several";
      projects: { path: string; name: string; foundBy: string }[];
    }
  | { kind: "none" };

const HOLDS_THREE: Scan = {
  kind: "several",
  projects: [
    { path: "C:\\dev\\letterman", name: "letterman", foundBy: ".git" },
    { path: "C:\\dev\\mintbird", name: "mintbird", foundBy: "package.json" },
    { path: "C:\\dev\\quizforma", name: "quizforma", foundBy: "package.json" },
  ],
};

function makeClient(options: {
  picked?: string | null;
  scan?: Scan;
  failOn?: string;
}) {
  const registered: { name: string; directory: string; groupId?: string }[] = [];
  const client = {
    workspaces: {
      pickFolder: async () => ({
        path: options.picked === undefined ? "C:\\dev" : options.picked,
      }),
      scanFolder: async () => options.scan ?? HOLDS_THREE,
      register: async (input: { name: string; directory: string; groupId?: string }) => {
        if (input.name === options.failOn) {
          throw new Error("This directory is already a workspace.");
        }
        registered.push(input);
        return { id: `ws-${input.name}`, name: input.name, path: input.directory };
      },
    },
  } as unknown as VynelClient;
  return { client, registered };
}

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
  document.body.innerHTML = "";
});

async function mountDialog(
  options: Parameters<typeof makeClient>[0] = {},
  groupId: string | null = null,
) {
  const fake = makeClient(options);
  const wrapper = mount(WhichProjectDialog, {
    props: { open: true, groupId },
    global: {
      plugins: [
        [
          VueQueryPlugin,
          {
            queryClient: new QueryClient({
              defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
            }),
          },
        ],
      ],
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

function button(text: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(text),
  );
  if (!match) throw new Error(`no button containing "${text}"`);
  return match as HTMLButtonElement;
}

async function choose() {
  button("Choose folder").click();
  await flushPromises();
}

describe("WhichProjectDialog", () => {
  it("opens with ONE button — the OS folder window is the picker", async () => {
    await mountDialog();

    expect(bodyText()).toContain("Which project?");
    expect(bodyText()).toContain("Choose folder");
    expect(bodyText()).toContain("Pick a folder to carry on");
    expect(document.body.querySelector("button.fs-tile")).toBeNull();
  });

  it("a folder that IS a project adds it, and says nothing moves", async () => {
    const { registered } = await mountDialog({
      picked: "C:\\dev\\letterman",
      scan: {
        kind: "single",
        project: { path: "C:\\dev\\letterman", name: "letterman", foundBy: ".git" },
      },
    });

    await choose();
    // The screen ANSWERS once it knows — it stops repeating the instruction.
    expect(bodyText()).toContain("Found it");
    expect(bodyText()).toContain("letterman");
    expect(bodyText()).toContain("nothing moves");
    expect(bodyText()).not.toContain("Pick the folder your projects live in");
    expect(bodyText()).toContain("Pick a different folder");

    button("Add it").click();
    await flushPromises();

    expect(registered).toEqual([{ name: "letterman", directory: "C:\\dev\\letterman" }]);
  });

  it("a folder that HOLDS projects ticks them all and adds several at once", async () => {
    const { wrapper, registered } = await mountDialog();

    await choose();
    expect(bodyText()).toContain("Which of these?");
    expect(bodyText()).toContain("letterman");
    expect(bodyText()).toContain("quizforma");

    button("Add 3 projects").click();
    await flushPromises();

    expect(registered.map((entry) => entry.name)).toEqual([
      "letterman",
      "mintbird",
      "quizforma",
    ]);
    // Every project that landed comes back — the shell decides off the count.
    const created = wrapper.emitted("created");
    expect(created).toHaveLength(1);
    expect((created![0]![0] as { name: string }[]).map((workspace) => workspace.name)).toEqual([
      "letterman",
      "mintbird",
      "quizforma",
    ]);
  });

  it("files every added project into the group the '+' was pressed on", async () => {
    const { registered } = await mountDialog({}, "group-7");

    await choose();
    button("Add 3 projects").click();
    await flushPromises();

    expect(registered.every((entry) => entry.groupId === "group-7")).toBe(true);
  });

  it("unticking one drops it from the count and from what gets added", async () => {
    const { registered } = await mountDialog();
    await choose();

    const boxes = [
      ...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    boxes[1]!.click();
    await flushPromises();

    expect(bodyText()).toContain("Add 2 projects");
    button("Add 2 projects").click();
    await flushPromises();

    expect(registered.map((entry) => entry.name)).toEqual(["letterman", "quizforma"]);
  });

  it("one failure never loses the rest — the others go in and it names the one that didn't", async () => {
    const { wrapper, registered } = await mountDialog({ failOn: "mintbird" });
    await choose();

    button("Add 3 projects").click();
    await flushPromises();

    expect(registered.map((entry) => entry.name)).toEqual(["letterman", "quizforma"]);
    expect(bodyText()).toContain("mintbird was not added");
    expect(bodyText()).toContain("already a workspace");
    expect(wrapper.emitted("created")![0]![0]).toHaveLength(2);
  });

  it("nothing recognisable says so, and still lets you add it anyway", async () => {
    const { registered } = await mountDialog({
      picked: "C:\\dev\\mystery",
      scan: { kind: "none" },
    });

    await choose();
    expect(bodyText()).toContain("Nothing recognised in there");
    expect(bodyText()).toContain("Add it anyway if you know it is a project");

    button("Add it").click();
    await flushPromises();

    expect(registered).toEqual([{ name: "mystery", directory: "C:\\dev\\mystery" }]);
  });

  it("cancelling the folder window changes nothing and shows no error", async () => {
    await mountDialog({ picked: null });

    await choose();

    expect(bodyText()).toContain("Pick a folder to carry on");
    expect(bodyText()).not.toContain("Nothing recognised");
    expect(document.body.querySelector(".text-danger")).toBeNull();
  });
});
