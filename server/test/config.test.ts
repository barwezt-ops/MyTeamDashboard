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
  expect(db.pragma("user_version", { simple: true })).toBe(1);
  expect(db.prepare("SELECT COUNT(*) AS count FROM agents").get()).toEqual({
    count: 0,
  });
  db.close();
});
