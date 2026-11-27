import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { dashboardData } from "../src/v2/data.js";
import { counts, homeView } from "../src/v2/home.js";
import { heatStatus } from "../src/v2/heat.js";
import { queuesFor } from "../src/v2/queues.js";
import { clockTime, shortName } from "../src/v2/templates.js";
import { freshness } from "../../web/src/design.js";
import { csv, tableHtml } from "../../web/src/v2/copy.js";
import type { SyncStatus } from "../src/api/dto.js";
import { seedTeam, teamConfig, TEAM_TODAY } from "../../fixtures/team.js";
import {
  fixtureConfig,
  seedAgents,
  seedAttendance,
} from "../../fixtures/v2.js";

const db = openDb(":memory:");
seedTeam(db);
const config = teamConfig();
const data = dashboardData(db, config, TEAM_TODAY);
const view = homeView(data);
afterAll(() => db.close());
const kpi = (key: string) => view.kpis.find((row) => row.key === key)!;

describe("Home", () => {
  it("labels results as yesterday and the plan as today", () => {
    expect(view.reportDay).toBe("2026-11-25");
    expect(view.kpis.map((row) => row.label)).toEqual([
      "Late yesterday",
      "Missing time yesterday",
      "Break exceeds yesterday",
      "QA average",
    ]);
    expect(kpi("late")).toMatchObject({
      value: "3",
      subline: "31 minutes across the team",
      tone: "warn",
    });
    expect(kpi("missing")).toMatchObject({ value: "40m", subline: "2 agents" });
    expect(kpi("breaks").value).toBe("3");
    expect(kpi("qa").value).toMatch(/^\d+\.\d%$/);
    expect(kpi("late").bars).toHaveLength(7);
  });

  it("raises only owner-set thresholds and writes them as sentences", () => {
    expect(view.urgent.sentences).toEqual([
      "Avery S. reached 4 lateness incidents (flag at 3)",
      "Jordan B. had missing time on 3 of the last 5 days",
    ]);
    expect(view.summary).toBe(
      "Two people need you before the 3:45 rush. Two more people have something due soon.",
    );
    expect(view.needs.map((row) => row.severity)).toEqual(
      [...view.needs.map((row) => row.severity)].sort(
        (a, b) =>
          ["URGENT", "SOON", "LATER"].indexOf(a) -
          ["URGENT", "SOON", "LATER"].indexOf(b),
      ),
    );
    expect(counts(data)).toEqual({ urgent: 2, coachingDue: 23 });
    // Day 6 of 30: nothing is due yet, so nobody is behind.
    expect(view.paceSummary).toBeNull();
    expect(view.needs.some((row) => row.kind === "pace")).toBe(false);
    expect(view.coaching).toMatchObject({
      done: 9,
      total: 32,
      atZero: 9,
      expected: 0,
      behind: 0,
      firstDue: "2026-12-05",
    });
  });

  it("puts agents behind pace from mid-cycle into one line", () => {
    const middle = homeView(dashboardData(db, config, "2026-12-05"));
    expect(middle.coaching).toMatchObject({ expected: 16, behind: 9 });
    expect(middle.paceSummary?.reason).toBe("9 agents behind coaching pace");
    expect(middle.needs.some((row) => row.kind === "pace")).toBe(false);
  });

  it("shows today's floor and a short line only against a baseline", () => {
    expect(view.floor.team).toBe(16);
    expect(view.floor.scheduled).toBe(
      queuesFor(data, TEAM_TODAY).reduce((s, q) => s + q.scheduled, 0),
    );
    expect(view.floor.away.join()).toContain("on annual");
    const queues = view.queues;
    expect(queues.map((q) => q.line)).toEqual([
      "Callbacks",
      "Inbound A",
      "Inbound B",
    ]);
    expect(queues[0]).toMatchObject({ baseline: null, short: 0 });
    expect(queues[2].short).toBe(Math.max(0, 5 - queues[2].scheduled));
    expect(view.floor.short.length).toBe(queues[2].short ? 1 : 0);
  });

  it("lists yesterday's exceptions only and the clean records", () => {
    expect(view.exceptions.map((row) => row.name)).toEqual([
      "Avery S.",
      "Casey H.",
      "Jordan B.",
      "Riley V.",
      "Sage M.",
      "Taylor F.",
    ]);
    // Planned annual leave is not an exception.
    expect(view.exceptions.map((row) => row.code)).not.toContain("99111");
    expect(view.exceptions[0]).toMatchObject({
      late: "16m",
      missing: null,
      status: "Present",
    });
    expect(view.week.days).toHaveLength(7);
    expect(view.week.rows[0].exceptions).toBeGreaterThanOrEqual(
      view.week.rows.at(-1)!.exceptions,
    );
    expect(view.lateness.bars).toHaveLength(14);
    expect(view.lateness.caption).toMatch(/week\. Worst day was/);
    expect(view.shoutout.people.map((p) => p.code)).toEqual(
      expect.arrayContaining(["99105", "99109", "99113"]),
    );
    expect(view.shoutout.people.map((p) => p.code)).not.toContain("99101");
    expect(view.shoutout.text).toContain("from 21 Nov to 25 Nov");
  });

  it("names the latest reported day when attendance is behind", () => {
    const later = homeView(dashboardData(db, config, "2026-11-28"));
    expect(later.reportDay).toBe("2026-11-25");
    expect(later.kpis[0].label).toBe("Late 25 Nov");
    const empty = openDb(":memory:");
    const bare = homeView(dashboardData(empty, config, TEAM_TODAY));
    expect(bare.kpis[0]).toMatchObject({
      value: "—",
      subline: "No attendance reported",
    });
    expect(bare.floor.team).toBe(0);
    expect(bare.shoutout.text).toBe("");
    empty.close();
  });
});

it("applies the owner's perfect attendance rule", () => {
  // Days off, annual leave, sick and public holidays are allowed.
  const allowed = [
    "Off",
    "Annual",
    "Sick",
    "Public Holiday",
    "Forced Annual",
    "1st Half Annual",
    "2nd Half Forced Annual",
  ];
  // Everything else on the owner's list ends it, whole or half day.
  const ending = [
    "UPL",
    "Forced UPL",
    "Casual",
    "NCNS",
    "AWOL",
    "1st Half UPL",
    "2nd Half Forced UPL",
  ];
  const own = openDb(":memory:");
  try {
    const statuses = [...allowed, ...ending];
    const codes = statuses.map((_, i) => String(99201 + i));
    seedAgents(
      own,
      codes.map((code) => [code, `Sample ${code}`]),
    );
    seedAttendance(
      own,
      codes.flatMap((code, i) => [
        { code, date: "2026-11-23" },
        { code, date: "2026-11-24", status: statuses[i] },
      ]),
      TEAM_TODAY,
    );
    const clean = () =>
      homeView(
        dashboardData(own, fixtureConfig(), TEAM_TODAY),
      ).shoutout.people.map((p) => p.code);
    expect(clean()).toEqual(codes.slice(0, allowed.length));
    // WFM MTD is for comparison; effective daily facts drive shout-outs.
    own
      .prepare(
        "UPDATE attendance_mtd_snapshots SET fields=json_set(fields,'$.latenessIncidents',1,'$.lateness','00:04:00') WHERE code=?",
      )
      .run(codes[0]);
    expect(clean()).toEqual(codes.slice(0, allowed.length));
  } finally {
    own.close();
  }
});

it("colours days with a text status and short names", () => {
  const facts = data.agents[0].calendar[4].attendance!;
  expect(heatStatus(facts, "Scheduled")).toBe("Late");
  expect(heatStatus({ ...facts, missing: 3 }, null)).toBe("Missing");
  expect(heatStatus(null, "Scheduled")).toBe("Scheduled");
  expect(heatStatus(null, "PTO")).toBe("Leave / sick");
  expect(heatStatus(null, "Unknown")).toBeNull();
  expect(shortName({ fullName: "Avery Stone", firstName: "Avery" })).toBe(
    "Avery S.",
  );
  expect(shortName({ fullName: "Avery", firstName: "" })).toBe("Avery");
  expect(clockTime("00:05")).toBe("12:05 AM");
  expect(clockTime("16:01")).toBe("4:01 PM");
});

it("describes source freshness in one line", () => {
  const status = {
    date: TEAM_TODAY,
    attendanceThrough: "2026-11-25",
    mtdSyncedOn: TEAM_TODAY,
    sources: [{ job: "attendance", enabled: true }, { job: "qa" }],
    jobs: {
      roster: {
        lastRun: { ok: true },
        lastSuccessAt: "2026-11-26T09:00:00Z",
      },
      qa: { lastRun: { ok: true }, lastSuccessAt: "2026-11-26T10:00:00Z" },
    },
  } as unknown as SyncStatus;
  const now = Date.parse("2026-11-26T12:00:00Z");
  expect(freshness(status, now)).toEqual({
    tone: "good",
    text: "Attendance & MTD through 25 Nov · QA synced 2h ago",
  });
  expect(
    freshness({ ...status, attendanceThrough: "2026-11-23" }, now).tone,
  ).toBe("waiting");
  const failed = freshness(
    {
      ...status,
      sources: [],
      jobs: { ...status.jobs, qa: { lastRun: { ok: false } } },
    } as unknown as SyncStatus,
    now,
  );
  const disagree = freshness(
    {
      ...status,
      mtdMismatch: [{ code: "99101", name: "Avery Stone" }],
    },
    now,
  );
  expect(disagree.tone).toBe("waiting");
  expect(disagree.text).toContain(
    "MTD and daily rows disagree for 1 agent(s): the paste may be missing rows",
  );
  expect(failed.tone).toBe("bad");
  expect(failed.text).toContain("Last sync failed");
  expect(failed.text).toContain("QA not connected");
});

it("escapes copied tables and neutralises spreadsheet formulas", () => {
  const table = { headers: ["A", "B"], rows: [["=1+1", '<b>"x",y</b>']] };
  expect(tableHtml(table)).toContain("&lt;b&gt;&quot;x&quot;,y&lt;/b&gt;");
  expect(csv(table)).toBe('A,B\r\n\'=1+1,"<b>""x"",y</b>"');
});
