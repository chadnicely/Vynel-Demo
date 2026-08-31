import { describe, expect, it } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import { useDemoStore } from "../stores/demo-store.js";

// HIS SOFTWARE AND NOBODY ELSE'S (Chad, 2026-08-31: "does it only use the
// software I have listed?"). A take draws its products from Defaults →
// Software. A film that named a product he had removed would be a re-shoot at
// best, and at worst a claim on camera about something that does not exist.
describe("a take only ever speaks about the listed software", () => {
  it("a roster of two never mentions a third", async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    const demo = useDemoStore();

    // Strip the roster down to two, the way Defaults → Software would.
    const keep = ["Mintbird", "Quizforma"];
    const dropped: string[] = [];
    for (const project of [...demo.projects]) {
      if (keep.includes(project.name)) {
        demo.setProjectUpdates(project.id, `${project.name} — the editor shipped.`);
      } else {
        dropped.push(project.name);
        demo.removeProject(project.id);
      }
    }
    await nextTick();
    demo.fillQueue();
    expect(demo.scripts.length).toBeGreaterThan(0);

    // Everything a take says: its spoken lines AND its written dialogue.
    const spoken: string[] = [];
    for (const take of demo.scripts) {
      for (const line of take.lines) spoken.push(line.text);
      const talk = take.conversation;
      if (talk !== undefined) {
        spoken.push(talk.opening, talk.handover, talk.software, talk.closing);
      }
    }
    const everything = spoken.join("\n");

    expect(dropped.filter((name) => everything.includes(name))).toEqual([]);
  });

  it("says nothing about a product with an empty update box", async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    const demo = useDemoStore();

    // One product speaks; the rest are listed but have nothing to say. A demo
    // reel must never claim work on something he has not reported.
    const [voice, ...silent] = demo.projects;
    demo.setProjectUpdates(voice!.id, `${voice!.name} — the editor shipped.`);
    for (const project of silent) demo.setProjectUpdates(project.id, "");
    await nextTick();
    demo.fillQueue();

    const productLines = demo.scripts.flatMap((take) =>
      take.lines.filter((line) => line.surface === "nodes"),
    );
    expect(productLines.length).toBeGreaterThan(0);
    for (const line of productLines) expect(line.projectId).toBe(voice!.id);
  });
});
