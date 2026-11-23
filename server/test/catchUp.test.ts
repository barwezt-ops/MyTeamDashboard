import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import { lastRun } from "../src/db/repo.js";
import { startLiveJobs } from "../src/sync/cron.js";
import { createSync } from "../src/sync/service.js";

it("checks the current Cairo time after sleep, runs today's jobs once, and waits an hour after a failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-catch-up-"));
  const db = openDb(":memory:");
  const config = loadConfig();
  config.jobs.daily = "0 16 * * *";
  config.sources.master.sheetId = "FakeMaster";
  config.sources.master.gid = "10";
  config.sources.schedule.sheetId = "FakeSchedule";
  config.sources.schedule.gid = "20";
  let time = new Date("2026-11-21T13:59:59Z");
  const now = () => time;
  const sync = createSync(db, config, "live", now);
  const start = vi.spyOn(sync, "start");
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetch);
  const backups = join(directory, "backups");
  writeFileSync(backups, "Force the first backup to fail");
  const jobs = startLiveJobs(db, directory, config, sync, now);
  const count = (job: string) =>
    db.prepare("SELECT COUNT(*) FROM sync_log WHERE job = ?").pluck().get(job);
  try {
    await jobs.check();
    expect(start).not.toHaveBeenCalled();
    expect(lastRun(db, "backup")?.ok).toBe(false);
    rmSync(backups);

    time = new Date("2026-11-21T14:45:00Z");
    const attempt = jobs.check();
    await jobs.check();
    expect(await attempt).toBe(false);
    expect(start).toHaveBeenCalledExactlyOnceWith("daily");
    expect(lastRun(db, "daily")?.ok).toBe(false);
    expect(count("backup")).toBe(1);

    time = new Date("2026-11-21T15:44:59Z");
    await jobs.check();
    expect(count("daily")).toBe(1);
    expect(count("backup")).toBe(2);
    expect(lastRun(db, "backup")?.ok).toBe(true);

    fetch.mockImplementation(async (url) => {
      const source =
        new URL(String(url)).searchParams.get("gid") === "10"
          ? "master"
          : "schedule";
      return new Response(
        readFileSync("fixtures/" + source + ".sample.csv", "utf8"),
        {
          headers: { "content-type": "text/csv" },
        },
      );
    });
    time = new Date("2026-11-21T15:45:00Z");
    expect(await jobs.check()).toBe(true);
    expect(lastRun(db, "daily")?.ok).toBe(true);
    time = new Date("2026-11-21T22:20:00+02:00");
    await jobs.check();
    expect(count("daily")).toBe(2);
    expect(count("backup")).toBe(2);
    expect(count("roster")).toBe(2);

    time = new Date("2026-11-22T18:00:00+02:00");
    expect(await jobs.check()).toBe(true);
    expect(count("daily")).toBe(3);
    expect(count("backup")).toBe(3);
    expect(count("roster")).toBe(2);
  } finally {
    jobs.stop();
    db.close();
    vi.unstubAllGlobals();
    rmSync(directory, { recursive: true, force: true });
  }
});
