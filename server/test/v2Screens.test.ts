import { afterAll, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { boardView } from "../src/v2/board.js";
import { dashboardData } from "../src/v2/data.js";
import { qualityView } from "../src/v2/quality.js";
import { readSettings, saveSettings } from "../src/v2/settings.js";
import { seedTeam, teamConfig, TEAM_TODAY } from "../../fixtures/team.js";

const db = openDb(":memory:");
seedTeam(db);
const config = teamConfig();
const load = (with_ = config) => dashboardData(db, with_, TEAM_TODAY);
afterAll(() => db.close());

it("summarises quality and marks gaps only after the owner sets the days", () => {
  let view = qualityView(load());
  expect(view.connected).toBe(true);
  expect(view.rows).toHaveLength(16);
  expect(view.distribution.reduce((s, band) => s + band.count, 0)).toBe(
    view.rows.filter((row) => row.average !== null).length,
  );
  const taylor = () => view.rows.find((row) => row.code === "99106")!;
  expect(taylor()).toMatchObject({
    latestDate: "2026-11-12",
    daysSince: 14,
    average: null,
    stale: false,
  });
  saveSettings(db, { ...readSettings(db), noQaDays: 14 });
  view = qualityView(load());
  expect(view.rows.filter((row) => row.stale).map((row) => row.code)).toEqual([
    "99106",
  ]);
  expect(view.summary).toContain("1 agent without a recent evaluation.");
  expect(load().flags.some((flag) => flag.kind === "qa-gap")).toBe(true);
});

it("shows an unconnected QA source as such", () => {
  const empty = openDb(":memory:");
  const view = qualityView(
    dashboardData(
      empty,
      { ...config, sources: { ...config.sources, qa: undefined } },
      TEAM_TODAY,
    ),
  );
  expect(view).toMatchObject({
    connected: false,
    hasScores: false,
    summary: "QA is not connected yet.",
  });
  empty.close();
});

it("covers two weeks per line, upcoming leave and line changes", () => {
  const view = boardView(load());
  expect(view.dates).toHaveLength(14);
  expect(view.coverage.map((row) => [row.line, row.baseline])).toEqual([
    ["Callbacks", null],
    ["Inbound A", null],
    ["Inbound B", 5],
  ]);
  const [callbacks, , inbound] = view.coverage;
  expect(callbacks.days.every((day) => day.short === 0)).toBe(true);
  for (const day of inbound.days)
    expect(day.short).toBe(Math.max(0, 5 - day.scheduled));
  expect(view.leave).toContainEqual(
    expect.objectContaining({
      code: "99111",
      type: "Annual",
      from: "2026-11-26",
      to: "2026-11-28",
      days: 3,
    }),
  );
  expect(view.changes).toEqual([
    expect.objectContaining({
      code: "99108",
      date: "2026-11-10",
      text: "Moved from Inbound A to Inbound B.",
    }),
  ]);
  saveSettings(db, { ...readSettings(db), staffing: {} });
  const counts = boardView(load());
  expect(counts.anyBaseline).toBe(false);
  expect(counts.summary).toMatch(/^\d+ people scheduled today\.$/);
});
