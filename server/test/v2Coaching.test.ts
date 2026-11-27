import { afterAll, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { dashboardData } from "../src/v2/data.js";
import { coachingView, prepView, prompts } from "../src/v2/coaching.js";
import { reasons } from "../src/v2/choices.js";
import { seedTeam, teamConfig, TEAM_TODAY } from "../../fixtures/team.js";

const db = openDb(":memory:");
seedTeam(db);
const data = dashboardData(db, teamConfig(), TEAM_TODAY);
const view = coachingView(data);
afterAll(() => db.close());

it("paces the team and orders agents by who needs it most", () => {
  expect(view.totals).toMatchObject({ done: 9, total: 32, due: 23 });
  // The fixture day is day 6 of 30, so 25 days remain including today.
  expect(view.daysToFinish).toBe(25);
  expect(view.pace).toBe("23 coachings to go in 25 days: one a day or fewer.");
  const order = view.agents.map((agent) => [agent.flags, agent.done]);
  expect(order.slice(0, 2).every(([flags]) => flags > 0)).toBe(true);
  for (let i = 1; i < view.agents.length; i++) {
    const [a, b] = [view.agents[i - 1], view.agents[i]];
    expect(a.flags >= b.flags).toBe(true);
    if (a.flags === b.flags) expect(a.done <= b.done).toBe(true);
    if (a.flags === b.flags && a.done === b.done)
      expect((a.last ?? "") <= (b.last ?? "")).toBe(true);
  }
});

it("groups follow-ups and keeps the history complete", () => {
  const groups = Object.fromEntries(
    view.followUps.map((row) => [row.code + row.from, row.group]),
  );
  expect(groups["991032026-11-19"]).toBe("today");
  expect(groups["991102026-11-23"]).toBe("overdue");
  expect(groups["991072026-11-21"]).toBe("upcoming");
  expect(groups["991012026-11-04"]).toBe("closed");
  expect(view.history).toHaveLength(12);
  expect(view.history[0].date >= view.history.at(-1)!.date).toBe(true);
});

it("counts coachings and notes per agent without judging them", () => {
  const drew = view.fairness.find((row) => row.code === "99108")!;
  expect(drew.cycle).toEqual({
    coachings: 2,
    corrective: 1,
    recognition: 1,
    followUp: 0,
    notes: 0,
  });
  const avery = view.fairness.find((row) => row.code === "99101")!;
  expect(avery.cycle.coachings).toBe(0);
  expect(avery.all).toMatchObject({ coachings: 1, corrective: 1, notes: 1 });
  expect(view.fairness.map((row) => row.name)).toEqual(
    view.fairness.map((row) => row.name).sort((a, b) => a.localeCompare(b)),
  );
});

it("prepares facts, evidence and question prompts", () => {
  const prep = prepView(data, "99101")!;
  const section = (title: string) =>
    prep.sections.find((row) => row.title === title)!;
  expect(section("Lateness this cycle")).toMatchObject({
    summary: "4 incidents, 38 minutes in total.",
  });
  expect(section("Lateness this cycle").lines).toContain("25 Nov: 16 minutes");
  expect(section("Last coaching").summary).toBe(
    "4 Nov. Agreed: Logged in by 15:45",
  );
  expect(section("Last coaching").lines).toEqual([
    "Not kept. Marked not kept by you.",
  ]);
  expect(prep.suggested).toEqual(["attendance"]);
  expect(prep.evidence[0].label).toBe(
    "URGENT: 4 lateness incidents this cycle",
  );
  expect(prep.evidence.map((item) => item.id)).toContain("99101|2026-11-25");
  expect(prepView(data, "99105")!.suggested).toEqual(["recognition"]);
  expect(prepView(data, "00000")).toBeNull();
  for (const reason of reasons) {
    expect(prompts[reason].every((text) => text.endsWith("?"))).toBe(true);
    expect(prompts[reason].join(" ")).not.toMatch(
      /health|sick|family|home life|motivat|stress/i,
    );
  }
});
