import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, configSchema } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import { jobRunner } from "../src/sync/runJob.js";
import { startLiveJobs } from "../src/sync/cron.js";
import { createSync } from "../src/sync/service.js";
import { dashboardData } from "../src/v2/data.js";
import {
  inspectHeaders,
  parseQa,
  parseQaReport,
  syncQa,
} from "../src/v2/sources.js";
import { seedAgents } from "../../fixtures/v2.js";

const serial = (iso: string) =>
  (Date.parse(iso + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86_400_000;

function qaConfig() {
  const config = loadConfig();
  return configSchema.parse({
    ...config,
    sources: {
      ...config.sources,
      qa: {
        label: "QA evaluations",
        access: "google",
        sheetId: "FakeQaSheet",
        gid: "999001",
        tab: "QA_raw",
        mode: "export",
        headerRows: 1,
        enabled: true,
        mappingApproved: true,
        scoreFormat: "fraction",
        columns: {
          code: "Code",
          date: "Case Date",
          score: "Score",
          autofail: "Autofail",
          account: "Account",
        },
      },
    },
  });
}

function googleQaFetch(
  header: string[],
  dataRows: (string | number | boolean)[][],
  options: { fail?: boolean; gid?: number } = {},
) {
  const calls: string[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "fake-token" });
    if (options.fail)
      return Response.json(
        { error: { message: "Backend error" } },
        { status: 500 },
      );
    if (url.searchParams.get("fields") === "sheets(properties(sheetId,title))")
      return Response.json({
        sheets: [
          { properties: { sheetId: options.gid ?? 999001, title: "QA_raw" } },
        ],
      });
    if (
      url.pathname.includes("/values/") &&
      !url.pathname.endsWith(":batchGet")
    )
      return Response.json({ values: [header] });
    if (url.pathname.endsWith(":batchGet")) {
      expect(url.searchParams.get("valueRenderOption")).toBe(
        "UNFORMATTED_VALUE",
      );
      expect(url.searchParams.get("dateTimeRenderOption")).toBe(
        "SERIAL_NUMBER",
      );
      expect(url.searchParams.getAll("ranges")).toEqual(["'QA_raw'!A2:E"]);
      return Response.json({
        values: undefined,
        valueRanges: [{ values: dataRows }],
      });
    }
    throw new Error("Unexpected URL " + url.href);
  };
  return { request, calls };
}

describe("QA_raw source", () => {
  let directory = "";
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
      directory = "";
    }
  });

  function setupGoogleAuth() {
    directory = mkdtempSync(join(tmpdir(), "team-qa-source-"));
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "fake-client");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "fake-secret");
    writeFileSync(
      join(directory, "google-token.json"),
      JSON.stringify({ refresh_token: "fake-refresh" }),
    );
    return directory;
  }

  it("1. header check passes with exact 5 headers and fails with a missing or renamed header", () => {
    const config = qaConfig();
    const valid = ["Code", "Case Date", "Score", "Autofail", "Account"];
    const inspected = inspectHeaders([
      valid,
      ["99001", "46350", "0.95", "", "Inbound"],
    ]);
    expect(inspected).toEqual({
      headers: [
        { column: "A", header: "Code", refused: false },
        { column: "B", header: "Case Date", refused: false },
        { column: "C", header: "Score", refused: false },
        { column: "D", header: "Autofail", refused: false },
        { column: "E", header: "Account", refused: false },
      ],
      rowCount: 1,
      stop: null,
    });
    expect(
      parseQa(
        [valid, ["99001", serial("2026-11-25"), 0.95, "", "Inbound"]],
        config,
        new Set(["99001"]),
      ),
    ).toHaveLength(1);

    // Missing Account
    expect(() =>
      parseQa(
        [
          ["Code", "Case Date", "Score", "Autofail"],
          ["99001", serial("2026-11-25"), 0.95, ""],
        ],
        config,
        new Set(["99001"]),
      ),
    ).toThrow("missing or refused");

    // Renamed Case Date
    expect(() =>
      parseQa(
        [
          ["Code", "Date", "Score", "Autofail", "Account"],
          ["99001", serial("2026-11-25"), 0.95, "", "Inbound"],
        ],
        config,
        new Set(["99001"]),
      ),
    ).toThrow("missing or refused");
  });

  it("2. converts 0-1 fraction scores to 0-100 percentages", () => {
    const config = qaConfig();
    const rows = [
      ["Code", "Case Date", "Score", "Autofail", "Account"],
      ["99001", serial("2026-11-25"), 0.95, "", "Inbound"],
      ["99001", serial("2026-11-24"), 0.29, "", "Dental"],
      ["99001", serial("2026-11-23"), 1, "", "Inbound"],
      ["99001", serial("2026-11-22"), 0, "Case Autofail", "Inbound"],
    ];
    expect(
      parseQa(rows, config, new Set(["99001"])).map((r) => r.score),
    ).toEqual([95, 29, 100, 0]);
  });

  it("3. converts date serials (including fractional timestamps) to the Cairo calendar date", () => {
    const config = qaConfig();
    const daySerial = serial("2026-11-25");
    const rows = [
      ["Code", "Case Date", "Score", "Autofail", "Account"],
      ["99001", daySerial, 0.9, "", "Inbound"],
      // Late evening serial fraction (23:30) stays on the same Cairo calendar date.
      ["99001", daySerial + 0.98, 0.92, "", "Inbound"],
      // DST day in Cairo (last Friday of October 2026: 2026-10-30).
      ["99001", serial("2026-10-30"), 0.88, "", "Dental"],
    ];
    expect(
      parseQa(rows, config, new Set(["99001"])).map((r) => r.date),
    ).toEqual(["2026-11-25", "2026-11-25", "2026-10-30"]);
  });

  it("4. maps autofail blank to false and 'Case Autofail' to true while keeping the label", () => {
    const config = qaConfig();
    const rows = [
      ["Code", "Case Date", "Score", "Autofail", "Account"],
      ["99001", serial("2026-11-25"), 0.95, "", "Inbound"],
      ["99001", serial("2026-11-24"), 0, "Case Autofail", "Dental"],
    ];
    expect(parseQa(rows, config, new Set(["99001"]))).toEqual([
      {
        code: "99001",
        date: "2026-11-25",
        score: 95,
        form: "",
        autofail: false,
        account: "Inbound",
      },
      {
        code: "99001",
        date: "2026-11-24",
        score: 0,
        form: "Case Autofail",
        autofail: true,
        account: "Dental",
      },
    ]);
  });

  it("5-9. performs full snapshot replace, enforces guards (fail, 0 rows, >50% drop, unknown codes), keeps duplicate same-day audits, and logs no change", async () => {
    const db = openDb(":memory:");
    const dataDir = setupGoogleAuth();
    const config = qaConfig();
    seedAgents(db, [
      ["99001", "Demo Agent"],
      ["99002", "Demo Two"],
    ]);
    const header = [
      "Code",
      "Case Date",
      "Score",
      "Autofail",
      "Account",
      "ExtraIgnored",
    ];
    const now = () => new Date("2026-11-27T12:00:00Z");

    try {
      // Initial full sync: 4 rows, including 2 same-day identical audits for 99001 and 1 unknown code 99999.
      const firstRows = [
        ["99001", serial("2026-11-25"), 0.95, "", "Inbound"],
        ["99001", serial("2026-11-25"), 0.95, "", "Inbound"],
        ["99002", serial("2026-11-24"), 0.85, "Case Autofail", "Dental"],
        ["99999", serial("2026-11-24"), 0.8, "", "Inbound"],
      ];
      const first = googleQaFetch(header, firstRows);
      expect(
        await jobRunner(db, now).runStep("qa", () =>
          syncQa(db, config, "live", now(), dataDir, first.request),
        ),
      ).toBe(true);
      expect(
        db
          .prepare(
            "SELECT code, date, score, form, autofail, account FROM qa_evaluations ORDER BY id",
          )
          .all(),
      ).toEqual([
        {
          code: "99001",
          date: "2026-11-25",
          score: 95,
          form: "",
          autofail: 0,
          account: "Inbound",
        },
        {
          code: "99001",
          date: "2026-11-25",
          score: 95,
          form: "",
          autofail: 0,
          account: "Inbound",
        },
        {
          code: "99002",
          date: "2026-11-24",
          score: 85,
          form: "Case Autofail",
          autofail: 1,
          account: "Dental",
        },
      ]);
      expect(
        db
          .prepare(
            "SELECT ok, rows_read, rows_kept, warnings FROM sync_log WHERE job='qa' ORDER BY id DESC LIMIT 1",
          )
          .get(),
      ).toEqual({
        ok: 1,
        rows_read: 4,
        rows_kept: 3,
        warnings: JSON.stringify(["Skipped 1 QA row with unknown agent code"]),
      });

      // Same data again -> "no change" warning, not an error.
      const unchanged = googleQaFetch(header, firstRows);
      expect(
        await jobRunner(db, now).runStep("qa", () =>
          syncQa(db, config, "live", now(), dataDir, unchanged.request),
        ),
      ).toBe(true);
      expect(
        JSON.parse(
          db
            .prepare(
              "SELECT warnings FROM sync_log WHERE job='qa' ORDER BY id DESC LIMIT 1",
            )
            .pluck()
            .get() as string,
        ),
      ).toContain("no change");

      // Read fails -> existing data untouched, error logged.
      const failed = googleQaFetch(header, [], { fail: true });
      expect(
        await jobRunner(db, now).runStep("qa", () =>
          syncQa(db, config, "live", now(), dataDir, failed.request),
        ),
      ).toBe(false);
      expect(
        db.prepare("SELECT COUNT(*) FROM qa_evaluations").pluck().get(),
      ).toBe(3);
      expect(
        db
          .prepare(
            "SELECT ok FROM sync_log WHERE job='qa' ORDER BY id DESC LIMIT 1",
          )
          .pluck()
          .get(),
      ).toBe(0);

      // 0 rows -> refused, data untouched.
      const empty = googleQaFetch(header, []);
      expect(
        await jobRunner(db, now).runStep("qa", () =>
          syncQa(db, config, "live", now(), dataDir, empty.request),
        ),
      ).toBe(false);
      expect(
        db.prepare("SELECT COUNT(*) FROM qa_evaluations").pluck().get(),
      ).toBe(3);

      // >50% drop (1 row vs previous 4) -> refused with "QA tab looks incomplete", data untouched.
      const dropped = googleQaFetch(header, [
        ["99001", serial("2026-11-26"), 0.99, "", "Inbound"],
      ]);
      expect(
        await jobRunner(db, now).runStep("qa", () =>
          syncQa(db, config, "live", now(), dataDir, dropped.request),
        ),
      ).toBe(false);
      expect(
        db
          .prepare(
            "SELECT error FROM sync_log WHERE job='qa' ORDER BY id DESC LIMIT 1",
          )
          .pluck()
          .get(),
      ).toBe("QA tab looks incomplete");
      expect(
        db.prepare("SELECT COUNT(*) FROM qa_evaluations").pluck().get(),
      ).toBe(3);

      // Full replace on next valid read (>=50% of 4 = 2 rows): removes old 99002 row.
      const replaced = googleQaFetch(header, [
        ["99001", serial("2026-11-26"), 0.99, "", "Inbound"],
        ["99001", serial("2026-11-26"), 0.97, "", "Inbound"],
      ]);
      expect(
        await jobRunner(db, now).runStep("qa", () =>
          syncQa(db, config, "live", now(), dataDir, replaced.request),
        ),
      ).toBe(true);
      expect(
        db
          .prepare("SELECT code, date, score FROM qa_evaluations ORDER BY id")
          .all(),
      ).toEqual([
        { code: "99001", date: "2026-11-26", score: 99 },
        { code: "99001", date: "2026-11-26", score: 97 },
      ]);
    } finally {
      db.close();
    }
  });

  it("10. computes cycle average using audits with case dates 21st->20th only", () => {
    const db = openDb(":memory:");
    try {
      const config = qaConfig();
      seedAgents(db, [
        ["99001", "Demo Agent"],
        ["99002", "Demo Two"],
      ]);
      const insert = db.prepare(
        "INSERT INTO qa_evaluations(code,date,score,form,autofail,account) VALUES (?,?,?,?,?,?)",
      );
      // Prior cycle: 2026-10-21 to 2026-11-20
      insert.run("99001", "2026-11-20", 70, "", 0, "Inbound");
      // Current cycle: 2026-11-21 to 2026-12-20
      insert.run("99001", "2026-11-21", 90, "", 0, "Inbound");
      insert.run("99001", "2026-12-20", 100, "", 0, "Inbound");
      // Next cycle boundary
      insert.run("99001", "2026-12-21", 50, "", 0, "Inbound");

      const data = dashboardData(db, config, "2026-11-27");
      const agent1 = data.agents.find((a) => a.code === "99001")!;
      const agent2 = data.agents.find((a) => a.code === "99002")!;
      expect(agent1.qaAverage).toBe(95);
      expect(agent1.priorQaAverage).toBe(70);
      expect(agent2.qaAverage).toBeNull();
    } finally {
      db.close();
    }
  });

  it("schedules QA every 60 minutes using the same working-hours setting as attendance paste", async () => {
    const config = qaConfig();
    Object.assign(config.sources.attendance, {
      access: "google",
      enabled: true,
      paste: { sheetId: "FakePaste", startHour: 12, endHour: 14 },
    });
    const db = openDb(":memory:");
    let time = new Date("2026-11-27T11:59:00+02:00");
    const now = () => time;
    const log = db.prepare(
      "INSERT INTO sync_log (job,started_at,finished_at,ok) VALUES (?,?,?,1)",
    );
    const stamp = now().toISOString();
    log.run("daily", stamp, stamp);
    log.run("roster", stamp, stamp);
    const sync = createSync(db, config, "live", now);
    const jobs = startLiveJobs(db, ":memory:", config, sync, now);
    const start = vi.spyOn(sync, "start").mockImplementation((job) => {
      const t = now().toISOString();
      log.run(job, t, t);
      return Promise.resolve(true);
    });
    try {
      // Outside 12:00-14:00 Cairo
      expect(jobs.check()).toBeUndefined();
      // 12:00 runs attendance first, then 12:15 runs qa in the same hour slot.
      time = new Date("2026-11-27T12:00:00+02:00");
      expect(await jobs.check()).toBe(true);
      time = new Date("2026-11-27T12:15:00+02:00");
      expect(await jobs.check()).toBe(true);
      expect(jobs.check()).toBeUndefined();
      // 14:00 is outside [12, 14)
      time = new Date("2026-11-27T14:00:00+02:00");
      expect(jobs.check()).toBeUndefined();
      expect(start.mock.calls).toEqual([["attendance"], ["qa"]]);
    } finally {
      jobs.stop();
      db.close();
    }
  });

  it("computes unknown code count correctly in parseQaReport without failing", () => {
    const config = qaConfig();
    const report = parseQaReport(
      [
        ["Code", "Case Date", "Score", "Autofail", "Account"],
        ["99888", serial("2026-11-25"), 0.91, "", "Inbound"],
        ["99889", serial("2026-11-25"), 0.88, "", "Dental"],
      ],
      config,
      new Set(["99001"]),
    );
    expect(report.records).toEqual([]);
    expect(report.rowsRead).toBe(2);
    expect(report.skippedUnknown).toBe(2);
    expect(report.warnings).toEqual([
      "Skipped 2 QA rows with unknown agent code",
    ]);
  });
});
