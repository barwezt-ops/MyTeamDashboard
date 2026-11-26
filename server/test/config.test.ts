import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { configSchema, loadConfig } from "../src/config.js";
import { openDb } from "../src/db/db.js";

it("defaults paste reads to all day and accepts windows that cross midnight", () => {
  const config = loadConfig();
  const attendance = config.sources.attendance;
  expect(
    configSchema.parse({
      ...config,
      sources: {
        ...config.sources,
        attendance: { ...attendance, paste: { sheetId: "FakePaste" } },
      },
    }).sources.attendance.paste,
  ).toEqual({ sheetId: "FakePaste", startHour: 0, endHour: 24 });
  attendance.paste = { sheetId: "FakePaste", startHour: 12, endHour: 2 };
  expect(configSchema.parse(config).sources.attendance.paste).toEqual(
    attendance.paste,
  );
});

it("uses DASHBOARD_CONFIG_FILE for live sync and link checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "team-dashboard-config-"));
  try {
    const file = join(directory, "local.json");
    const config = loadConfig();
    config.me.rosterName = "External Demo Lead";
    config.sources.master.sheetId = "FakeMaster";
    config.sources.master.gid = "10";
    config.sources.schedule.sheetId = "FakeSchedule";
    config.sources.schedule.gid = "20";
    writeFileSync(file, JSON.stringify(config));
    vi.stubEnv("DASHBOARD_SOURCE_CONFIG", "{}");
    vi.stubEnv("DASHBOARD_CONFIG_FILE", file);
    expect(loadConfig(undefined, "live")).toEqual(config);
    expect(loadConfig(undefined, "live", true)).toEqual(config);
    expect(loadConfig().me.rosterName).not.toBe(config.me.rosterName);
    vi.stubEnv("DASHBOARD_CONFIG_FILE", join(directory, "missing.json"));
    expect(() => loadConfig(undefined, "live")).toThrow("missing.json");
  } finally {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("loads the workspace config and rejects an invalid schedule anchor or cron", () => {
  const config = loadConfig();
  expect(
    configSchema.safeParse({
      ...config,
      jobs: { ...config.jobs, daily: "typo" },
    }).success,
  ).toBe(false);
  expect(
    configSchema.safeParse({
      ...config,
      sources: {
        ...config.sources,
        schedule: {
          ...config.sources.schedule,
          anchor: { column: "F", date: "2026-02-31" },
        },
      },
    }).success,
  ).toBe(false);
});
it("initializes the SQLite schema", () => {
  const db = openDb(":memory:");
  expect(db.pragma("user_version", { simple: true })).toBe(2);
  expect(db.prepare("SELECT COUNT(*) AS count FROM agents").get()).toEqual({
    count: 0,
  });
  db.close();
});

it("migrates date-keyed D5 rows to one id and retains first seen and earlier comments", () => {
  const directory = mkdtempSync(join(tmpdir(), "team-dashboard-d5-"));
  try {
    const legacy = openDb(directory);
    legacy.pragma("user_version = 1");
    const insert = legacy.prepare(`
      INSERT INTO discrepancies (id, code, date, rule_id, tl_comment, state, created_at, updated_at)
      VALUES (?, 'demo', ?, 'D5', ?, ?, ?, ?)
    `);
    insert.run(
      "demo|2026-11-20|D5",
      "2026-11-20",
      "Keep this note",
      "resolved",
      "2026-11-20",
      "2026-11-21",
    );
    insert.run(
      "demo|2026-11-21|D5",
      "2026-11-21",
      "",
      "open",
      "2026-11-21",
      "2026-11-21",
    );
    legacy.close();

    const migrated = openDb(directory);
    try {
      expect(
        migrated
          .prepare("SELECT id, date, state, tl_comment FROM discrepancies")
          .all(),
      ).toEqual([
        {
          id: "demo|D5",
          date: "2026-11-20",
          state: "open",
          tl_comment: "Keep this note",
        },
      ]);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
