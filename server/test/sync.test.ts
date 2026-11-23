import { expect, it, vi } from "vitest";
import {
  agentsOf,
  lastRun,
  attendanceOf,
  discrepanciesOf,
  scheduleOf,
} from "../src/db/repo.js";
import { openDb } from "../src/db/db.js";
import { loadConfig } from "../src/config.js";
import { createSync } from "../src/sync/service.js";
import { rosterChanges } from "../src/sync/syncRoster.js";
import { fetchCsv, SourceAccessError } from "../src/fetch/fetchCsv.js";
import { exportUrl, parseLink, sourceUrl } from "../src/fetch/urls.js";
import { sample, sampleMaster, window } from "./sample.js";
import * as fixtureFiles from "../src/fetch/fixtures.js";

it("reports roster lifecycle changes and applies the suspicious-drop guard", () => {
  const { agents } = sampleMaster();
  const incoming = agents
    .slice(1)
    .map((agent) =>
      agent.code === "99002"
        ? { ...agent, dtl: "New Lead" }
        : agent.code === "99008"
          ? { ...agent, active: true }
          : agent,
    );
  incoming.push({ ...agents[0], code: "99999" });
  expect(
    rosterChanges(agents, incoming).events.map((event) => event.type),
  ).toEqual(["moved", "rejoined", "new", "left"]);
  expect(() => rosterChanges(agents, agents.slice(0, 2))).toThrow(
    "ROSTER_DROP_SUSPICIOUS",
  );
  expect(() => rosterChanges(agents, [])).toThrow("NO_TEAM_ROWS");
});
it("serializes syncs, retains prior snapshots across a failed run and can include attendance", async () => {
  const config = loadConfig();
  config.sources.attendance.enabled = true;
  const db = openDb(":memory:");
  const sync = createSync(
    db,
    config,
    "fixture",
    () => new Date("2026-11-21T11:00:00Z"),
  );
  const first = sync.start("all");
  expect(first).not.toBeNull();
  expect(sync.start("daily")).toBeNull();
  expect(await first).toBe(true);
  expect(agentsOf(db)).toHaveLength(7);
  expect(attendanceOf(db, window)).toHaveLength(4);
  expect(discrepanciesOf(db).some((row) => row.ruleId === "D4")).toBe(true);
  expect(discrepanciesOf(db).filter((row) => row.ruleId === "D5")).toHaveLength(
    2,
  );
  expect(await sync.start("daily")).toBe(true);
  config.me.rosterName = "Unknown";
  config.me.alsoCover = [];
  expect(await sync.start("roster")).toBe(false);
  expect(lastRun(db, "roster")).toMatchObject({
    ok: false,
    error: "NO_TEAM_ROWS",
  });
  expect(agentsOf(db)).toHaveLength(7);
  db.close();
});
it("builds public links, retries temporary responses and rejects HTML", async () => {
  expect(
    parseLink(
      "https://docs.google.com/spreadsheets/d/test-99/edit?gid=3#gid=2",
    ),
  ).toEqual({ sheetId: "test-99", gid: "2" });
  expect(() =>
    parseLink("https://example.invalid/spreadsheets/d/test/edit"),
  ).toThrow();
  const source = {
    ...loadConfig().sources.master,
    sheetId: "fixture",
    gid: "0",
  };
  expect(sourceUrl(source)).toBe(exportUrl("fixture", "0"));
  expect(sourceUrl({ ...source, mode: "gviz", query: "select B,C" })).toContain(
    "tq=select+B%2CC",
  );
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("back later", { status: 503 }))
    .mockResolvedValueOnce(
      new Response("\uFEFFa,b\n1,2\n3", {
        headers: { "content-type": "text/csv" },
      }),
    );
  expect(
    await fetchCsv(exportUrl("fixture", "0"), request, vi.fn()),
  ).toMatchObject({ rows: [["a", "b"], ["1", "2"], ["3"]], status: 200 });
  await expect(
    fetchCsv(
      exportUrl("fixture", "0"),
      vi.fn().mockResolvedValue(new Response("<!doctype html>")),
      vi.fn(),
    ),
  ).rejects.toThrow(SourceAccessError);
});

it("retains December history when the January source coverage starts inside the sync window", async () => {
  const config = loadConfig();
  config.sources.attendance.enabled = true;
  const fixtures = vi
    .spyOn(fixtureFiles, "readFixture")
    .mockImplementation((source) => ({
      bytes: 0,
      rows:
        source === "master"
          ? sample("master")
          : source === "schedule"
            ? [
                ["Code", "", "", "", "", "Tuesday", "Wednesday", "removed"],
                ["99001", "", "", "", "", "15:45", "Off"],
              ]
            : [
                ["Code", "", "", "", "Date", "Status"],
                [
                  "99001",
                  "",
                  "",
                  "",
                  config.sources.schedule.anchor.date,
                  "Present",
                ],
              ],
    }));
  const db = openDb(":memory:");
  try {
    const sync = createSync(
      db,
      config,
      "fixture",
      () => new Date("2027-01-02T11:00:00Z"),
    );
    config.sources.schedule.anchor.date = "2026-12-29";
    expect(await sync.start("all")).toBe(true);
    config.sources.schedule.anchor.date = "2027-01-01";
    expect(await sync.start("daily")).toBe(true);
    const range = sync.window();
    expect(scheduleOf(db, range).map(({ date }) => date)).toEqual([
      "2026-12-29",
      "2026-12-30",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(attendanceOf(db, range).map(({ date }) => date)).toEqual([
      "2026-12-29",
      "2027-01-01",
    ]);
  } finally {
    db.close();
    fixtures.mockRestore();
  }
});

it("intersects attendance coverage with the sync window before replacing history", async () => {
  const config = loadConfig();
  config.sources.attendance.enabled = true;
  const fixtures = vi
    .spyOn(fixtureFiles, "readFixture")
    .mockImplementation((source) => ({
      bytes: 0,
      rows:
        source !== "attendance"
          ? sample(source)
          : [
              ["Code", "", "", "", "Date", "Status"],
              ...["2026-10-01", "2026-11-20", "2026-12-20"].map((date) => [
                "99001",
                "",
                "",
                "",
                date,
                "Present",
              ]),
            ],
    }));
  const db = openDb(":memory:");
  try {
    const insert = db.prepare(
      "INSERT INTO attendance_days (code, date, raw, status) VALUES ('99001', ?, 'Present', 'Present')",
    );
    for (const date of ["2026-10-01", window.from, window.to, "2026-12-20"])
      insert.run(date);
    const sync = createSync(
      db,
      config,
      "fixture",
      () => new Date("2026-11-21T11:00:00Z"),
    );
    expect(await sync.start("all")).toBe(true);
    expect(
      attendanceOf(db, { from: "2026-10-01", to: "2026-12-20" }).map(
        ({ date }) => date,
      ),
    ).toEqual(["2026-10-01", "2026-11-20", "2026-12-20"]);
  } finally {
    db.close();
    fixtures.mockRestore();
  }
});

it("keeps one open D5 and its comment across daily syncs until the agent is scheduled", async () => {
  const fixtures = vi.spyOn(fixtureFiles, "readFixture");
  const db = openDb(":memory:");
  try {
    let date = "2026-11-21";
    const sync = createSync(
      db,
      loadConfig(),
      "fixture",
      () => new Date(date + "T11:00:00Z"),
    );
    const findings = () =>
      discrepanciesOf(db, "d.rule_id='D5' AND d.code=?", ["99004"]);
    expect(await sync.start("all")).toBe(true);
    db.prepare("UPDATE discrepancies SET tl_comment=? WHERE id=?").run(
      "Followed up with WFM",
      "99004|D5",
    );
    for (const day of ["2026-11-22", "2026-11-23"]) {
      date = day;
      expect(await sync.start("daily")).toBe(true);
      expect(findings()).toMatchObject([
        {
          id: "99004|D5",
          date: "2026-11-21",
          state: "open",
          tlComment: "Followed up with WFM",
        },
      ]);
    }

    const schedule = sample("schedule");
    schedule.push(["99004", ...schedule[1].slice(1)]);
    fixtures.mockImplementation((source) => ({
      bytes: 0,
      rows: source === "schedule" ? schedule : sample(source),
    }));
    date = "2026-11-24";
    expect(await sync.start("daily")).toBe(true);
    expect(findings()).toMatchObject([
      {
        id: "99004|D5",
        date: "2026-11-21",
        state: "resolved",
        tlComment: "Followed up with WFM",
      },
    ]);
    expect(
      db
        .prepare("SELECT auto_cleared FROM discrepancies WHERE id=?")
        .get("99004|D5"),
    ).toEqual({ auto_cleared: 1 });
  } finally {
    db.close();
    fixtures.mockRestore();
  }
});
