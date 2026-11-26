import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import { lastRun } from "../src/db/repo.js";
import { startLiveJobs } from "../src/sync/cron.js";
import { createSync } from "../src/sync/service.js";
import { jobRunner } from "../src/sync/runJob.js";

function liveConfig() {
  const config = loadConfig();
  config.jobs.daily = "0 16 * * *";
  config.sources.master.sheetId = "FakeMaster";
  config.sources.master.gid = "10";
  config.sources.schedule.sheetId = "FakeSchedule";
  config.sources.schedule.gid = "20";
  return config;
}

async function fetchFixture(url: Parameters<typeof globalThis.fetch>[0]) {
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
}

it("runs browser attendance once per working hour, without overlapping a sync", async () => {
  const config = liveConfig();
  Object.assign(config.sources.attendance, {
    access: "browser",
    enabled: true,
    browser: {
      ...config.sources.attendance.browser,
      startHour: 9,
      endHour: 11,
    },
  });
  const db = openDb(":memory:");
  const date = (time: string) => new Date("2026-11-21T" + time + ":00+02:00");
  let time = date("08:59");
  const now = () => time;
  const seed = db.prepare(
    "INSERT INTO sync_log (job,started_at,finished_at,ok) VALUES (?,?,?,1)",
  );
  seed.run("roster", date("08:00").toISOString(), date("08:00").toISOString());
  seed.run("daily", date("08:00").toISOString(), date("08:00").toISOString());
  const runner = jobRunner(db, now, true);
  let release!: () => void;
  const action = vi.fn(
    () =>
      new Promise<{ rowsRead: number; rowsKept: number; warnings: string[] }>(
        (resolve) => {
          release = () => resolve({ rowsRead: 4, rowsKept: 1, warnings: [] });
        },
      ),
  );
  const start = vi.fn((job: "attendance") =>
    runner.start(job, () => runner.runStep("attendance", action)),
  );
  const sync = {
    ...createSync(db, config, "live", now),
    start,
    get active() {
      return runner.active;
    },
  };
  const live = startLiveJobs(db, ":memory:", config, sync, now);
  try {
    expect(live.check()).toBeUndefined();
    time = date("09:10");
    const running = live.check();
    expect(live.check()).toBeUndefined();
    expect(start).toHaveBeenCalledExactlyOnceWith("attendance");
    await Promise.resolve();
    release();
    expect(await running).toBe(true);
    expect(live.check()).toBeUndefined();
    time = date("10:00");
    const second = live.check();
    await Promise.resolve();
    release();
    expect(await second).toBe(true);
    time = date("11:00");
    expect(live.check()).toBeUndefined();
    expect(start).toHaveBeenCalledTimes(2);
    expect(lastRun(db, "daily")?.startedAt).toBe(date("08:00").toISOString());
  } finally {
    live.stop();
    db.close();
  }
});

it.each([
  ["10:00", "16:05", true, 21],
  ["16:00", "16:30", false, 21],
  ["10:00", "20:00", true, 21],
  ["10:00", "09:00", true, 22],
] as const)(
  "uses the 16:00 Cairo slot after a successful run at %s and a check at %s",
  async (initial, resume, shouldRun, resumeDay) => {
    const config = liveConfig();
    const db = openDb(":memory:");
    const date = (time: string, day = 21) =>
      new Date("2026-11-" + day + "T" + time + ":00+02:00");
    let time = date(initial);
    const now = () => time;
    const sync = createSync(db, config, "live", now);
    const jobs = startLiveJobs(db, ":memory:", config, sync, now);
    const start = vi.spyOn(sync, "start");
    vi.stubGlobal("fetch", fetchFixture);
    try {
      expect(await sync.start(initial === "16:00" ? "daily" : "all")).toBe(
        true,
      );
      if (resume === "20:00") {
        time = date("15:00");
        expect(jobs.check()).toBeUndefined();
      }
      start.mockClear();
      time = date(resume, resumeDay);
      expect(await jobs.check()).toBe(shouldRun ? true : undefined);
      expect(jobs.check()).toBeUndefined();
      expect(start.mock.calls).toEqual(shouldRun ? [["daily"]] : []);
    } finally {
      jobs.stop();
      db.close();
      vi.unstubAllGlobals();
    }
  },
);

it.each([true, false])(
  "starts All once at 10:00 Cairo on an empty live database (success %s)",
  async (success) => {
    const config = liveConfig();
    const db = openDb(":memory:");
    const now = () => new Date("2026-11-21T10:00:00+02:00");
    const sync = createSync(db, config, "live", now);
    const jobs = startLiveJobs(db, ":memory:", config, sync, now);
    const start = vi.spyOn(sync, "start");
    vi.stubGlobal(
      "fetch",
      success ? fetchFixture : async () => new Response(null, { status: 404 }),
    );
    try {
      const bootstrap = jobs.check();
      expect(jobs.check()).toBeUndefined();
      expect(await bootstrap).toBe(success);
      expect(jobs.check()).toBeUndefined();
      expect(start).toHaveBeenCalledExactlyOnceWith("all");
    } finally {
      jobs.stop();
      db.close();
      vi.unstubAllGlobals();
    }
  },
);

it("checks the current Cairo time after sleep, runs today's jobs once, and waits an hour after a failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-catch-up-"));
  const db = openDb(":memory:");
  const config = liveConfig();
  const seed = db.prepare(
    "INSERT INTO sync_log (job, started_at, finished_at, ok) VALUES (?, ?, ?, 1)",
  );
  seed.run("daily", "2026-11-20T14:00:00.000Z", "2026-11-20T14:01:00.000Z");
  seed.run("roster", "2026-11-13T14:00:00.000Z", "2026-11-13T14:01:00.000Z");
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
    expect(count("daily")).toBe(2);
    expect(count("backup")).toBe(2);
    expect(lastRun(db, "backup")?.ok).toBe(true);

    fetch.mockImplementation(fetchFixture);
    time = new Date("2026-11-21T15:45:00Z");
    expect(await jobs.check()).toBe(true);
    expect(lastRun(db, "daily")?.ok).toBe(true);
    time = new Date("2026-11-21T22:20:00+02:00");
    await jobs.check();
    expect(count("daily")).toBe(3);
    expect(count("backup")).toBe(2);
    expect(count("roster")).toBe(3);

    time = new Date("2026-11-22T18:00:00+02:00");
    expect(await jobs.check()).toBe(true);
    expect(count("daily")).toBe(4);
    expect(count("backup")).toBe(3);
    expect(count("roster")).toBe(3);
  } finally {
    jobs.stop();
    db.close();
    vi.unstubAllGlobals();
    rmSync(directory, { recursive: true, force: true });
  }
});
