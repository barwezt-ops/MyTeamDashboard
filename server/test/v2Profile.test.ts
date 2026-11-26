import { afterAll, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { dashboardData } from "../src/v2/data.js";
import { escalationText, mprText } from "../src/v2/documents.js";
import {
  newHireBadge,
  outcomeText,
  profileView,
  shiftPattern,
  tenureText,
} from "../src/v2/profile.js";
import { seedTeam, teamConfig, TEAM_TODAY } from "../../fixtures/team.js";

const db = openDb(":memory:");
seedTeam(db);
const data = dashboardData(db, teamConfig(), TEAM_TODAY);
const profile = (code: string) => profileView(data, code, [])!;
afterAll(() => db.close());

it("builds a scorecard against the team average from recorded days", () => {
  const view = profile("99101");
  expect(view.agent).toMatchObject({
    name: "Avery Stone",
    line: "Inbound A",
    shift: "3:45 PM · off Fri, Sat",
    newHire: null,
  });
  const score = Object.fromEntries(view.scorecard.map((row) => [row.key, row]));
  expect(score.lateCount).toMatchObject({ value: "4", team: "0.5" });
  expect(score.lateMinutes.value).toBe("38m");
  expect(score.missingMinutes.value).toBe("0m");
  expect(score.qa.value).toMatch(/%$/);
  expect(view.trends).toHaveLength(6);
  expect(view.trends.at(-1)).toMatchObject({ lateCount: 4, lateMinutes: 38 });
  // Cycles with no recorded days stay empty and are not shown as zero.
  expect(view.trends[0]).toMatchObject({ reported: 0, lateMinutes: null });
  expect(view.calendar).toHaveLength(30);
  expect(profileView(data, "00000", [])).toBeNull();
});

it("says whether agreed steps were kept, from data or the owner's mark", () => {
  expect(profile("99103").coaching.timeline[0].step).toMatchObject({
    result: "not kept",
    text: "1 lateness incident through 26 Nov. Agreed limit: 0.",
  });
  expect(profile("99101").coaching.timeline[0].step).toEqual({
    result: "not kept",
    text: "Marked not kept by you.",
  });
  expect(profile("99112").coaching.timeline[0].step.result).toBe("pending");
  expect(outcomeText("none", null, null, null).text).toBe("No follow-up set.");
  expect(outcomeText("none", null, "2026-11-30", "open").text).toBe(
    "Follow-up 30 Nov.",
  );
});

it("derives hire stages, tenure and shift patterns", () => {
  expect(newHireBadge("2026-11-20", TEAM_TODAY)).toBe(
    "New hire · first 30 days",
  );
  expect(newHireBadge("2026-10-04", TEAM_TODAY)).toBe(
    "New hire · first 60 days",
  );
  expect(newHireBadge("2026-08-30", TEAM_TODAY)).toBe(
    "New hire · first 90 days",
  );
  expect(newHireBadge("2026-08-27", TEAM_TODAY)).toBeNull();
  expect(tenureText("2025-01-12", TEAM_TODAY)).toBe("1 year 10 months");
  expect(tenureText("2026-11-20", TEAM_TODAY)).toBe("6 days");
  expect(tenureText(null, TEAM_TODAY)).toBeNull();
  const agent = data.agents[0];
  expect(shiftPattern({ ...agent, lineTemplate: null, next14: [] })).toBeNull();
});

it("drafts documents from facts and includes private notes only on request", () => {
  const view = profile("99101");
  const draft = escalationText(view);
  expect(draft).toContain("Escalation draft: Avery Stone (99101)");
  expect(draft).toContain("- 25 Nov: late 16m");
  expect(draft).toContain("4 lateness incidents this cycle. Flag at 3");
  expect(draft).toContain("Agreed next step: Logged in by 15:45");
  const mpr = mprText(view);
  expect(mpr).toContain("- Late incidents: 4 (0.5)");
  for (const text of [draft, mpr]) {
    expect(text).not.toContain("earlier shift");
    expect(text).not.toMatch(/motiv|attitude|health|lazy/i);
  }
  expect(mprText(view, true)).toContain("earlier shift");
  expect(escalationText(view, true)).toContain("Private notes");
});
