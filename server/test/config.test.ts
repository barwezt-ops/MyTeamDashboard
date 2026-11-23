import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { configSchema, loadConfig } from "../src/config.js";
import { openDb } from "../src/db/db.js";

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
