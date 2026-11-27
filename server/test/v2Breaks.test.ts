// Break minutes are shown wherever breaks appear. The source's label stays the
// signal that a break was exceeded.
import { afterAll, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { prepView } from "../src/v2/coaching.js";
import { dashboardData } from "../src/v2/data.js";
import { escalationText } from "../src/v2/documents.js";
import { dayFacts } from "../src/v2/facts.js";
import { gridView } from "../src/v2/grid.js";
import { homeView } from "../src/v2/home.js";
import { profileView } from "../src/v2/profile.js";
import { cycleSummary } from "../src/v2/reports.js";
import { readSettings, saveSettings } from "../src/v2/settings.js";
import { breakOver } from "../src/v2/templates.js";
import { seedTeam, teamConfig, TEAM_TODAY } from "../../fixtures/team.js";

const db = openDb(":memory:");
seedTeam(db);
saveSettings(db, { ...readSettings(db), breakConsecutive: 3 });
const data = dashboardData(db, teamConfig(), TEAM_TODAY);
afterAll(() => db.close());

it("shows the minutes over wherever a break appears", () => {
  const home = homeView(data);
  expect(home.exceptions.find((row) => row.code === "99104")?.break).toBe(
    "1h 16m",
  );
  expect(home.kpis[2]).toMatchObject({
    value: "3",
    // 11, 76 and 6 minutes over yesterday.
    subline: "1h 33m over in total",
  });
  const row = gridView(data).rows.find((item) => item.code === "99104")!;
  expect(row.totals).toMatchObject({ breaks: 3, breakMinutes: 89 });
  const day = row.cells.find((cell) => cell.date === "2026-11-24")!;
  expect(day.details).toContainEqual(["Break", "9m over"]);
  expect(data.flags.find((flag) => flag.kind === "breaks")?.detail).toBe(
    "Flag at 3 · 1h 29m over in total",
  );
  const profile = profileView(data, "99104", [])!;
  expect(profile.scorecard.find((item) => item.key === "breaks")).toMatchObject(
    { value: "3", note: "1h 29m over in total" },
  );
  expect(profile.patterns).toContain(
    "Break exceeded 3 days running, 1h 29m over in total.",
  );
  const section = prepView(data, "99104")!.sections.find(
    (item) => item.title === "Break exceeds",
  )!;
  expect(section.summary).toBe("Exceeded on 3 days, 1h 29m over in total.");
  expect(section.lines).toContain("24 Nov: 9m over");
  expect(escalationText(profile)).toContain("break exceeded by 9m");
  expect(cycleSummary(data).text).toContain("over in total");
});

it("keeps the label as the signal and minutes as detail", () => {
  const facts = (details: Record<string, unknown>) =>
    dayFacts(
      {
        code: "99001",
        date: "2026-11-25",
        raw: "Active - Site",
        status: "Present",
        missing: null,
      },
      details,
      "Exceeded",
    );
  // Minutes without the label do not count as an exceeded break.
  expect(facts({ breakOver: "00:05:00" })).toMatchObject({
    breakExceeded: false,
    breakMinutes: null,
  });
  // The label without minutes still counts, and reads as before.
  expect(facts({ exceeded: "Exceeded" })).toMatchObject({
    breakExceeded: true,
    breakMinutes: null,
  });
  expect(breakOver(null)).toBe("Exceeded");
  expect(breakOver(0.25)).toBe("<1m");
  expect(breakOver(6)).toBe("6m");
});
