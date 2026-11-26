import cron from "node-cron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/db.js";
import {
  backupName,
  backupTimezone,
  runNightlyBackup,
} from "../backup/files.js";
import type { Config } from "../config.js";
import { lastDailyStart, lastRun, lastSuccess } from "../db/repo.js";
import { localDate } from "../parse/normalize.js";
import type { SyncService } from "./service.js";
export function startCron(config: Config, sync: SyncService) {
  const options = { timezone: config.timezone };
  return [
    cron.schedule(
      config.jobs.weekly,
      () => {
        void sync.start("roster");
      },
      options,
    ),
    cron.schedule(
      config.jobs.daily,
      () => {
        void sync.start("daily");
      },
      options,
    ),
  ];
}

export function startBackupCron(db: Db, directory: string) {
  return cron.schedule(
    "0 2 * * *",
    () => {
      runNightlyBackup(db, directory);
    },
    { timezone: backupTimezone },
  );
}

const hour = 3_600_000;

function cronOffsets(pattern: string) {
  const { minute, second } = cron.parse(pattern);
  return minute
    .flatMap((m) => second.map((s) => m * 60_000 + s * 1000))
    .sort((a, b) => b - a);
}

// Cairo's offsets are whole hours, including DST. Within an hour, the newest
// allowed minute and second match exactly when the hour and calendar match.
function latestDue(
  task: ReturnType<typeof cron.createTask>,
  offsets: number[],
  time: number,
  after: number,
) {
  for (
    let start = Math.floor(time / hour) * hour;
    start + hour > after;
    start -= hour
  ) {
    const offset = offsets.find((offset) => start + offset <= time);
    if (offset === undefined) continue;
    const candidate = start + offset;
    if (candidate <= after) break;
    if (task.match(new Date(candidate))) return candidate;
  }
}

export function startLiveJobs(
  db: Db,
  directory: string,
  config: Config,
  sync: SyncService,
  now = () => new Date(),
) {
  const timezone = backupTimezone;
  const options = { timezone, suppressMissedWarning: true };
  const backupPattern = "0 2 * * *";
  const dailyOffsets = cronOffsets(config.jobs.daily);
  const paste =
    config.sources.attendance.access === "google" &&
    config.sources.attendance.enabled
      ? config.sources.attendance.paste
      : undefined;
  let bootstrapAttempted = false;

  function canRetry(job: "daily" | "backup", time: Date) {
    const last = lastRun(db, job);
    return (
      !last ||
      last.ok === true ||
      time.getTime() - Date.parse(last.finishedAt ?? last.startedAt) >= hour
    );
  }

  function check() {
    if (sync.active) return;
    const time = now();
    const timestamp = time.getTime();
    const date = localDate(timezone, time);
    if (
      directory !== ":memory:" &&
      !existsSync(join(directory, "backups", backupName(time))) &&
      canRetry("backup", time)
    ) {
      const due = latestDue(
        backup,
        backupOffsets,
        timestamp,
        timestamp - 25 * hour,
      );
      if (due !== undefined && localDate(timezone, new Date(due)) === date)
        runNightlyBackup(db, directory, time);
    }

    if (!bootstrapAttempted && !lastSuccess(db, "roster")) {
      bootstrapAttempted = true;
      return sync.start("all");
    }
    const completed = lastDailyStart(db);
    if (
      canRetry("daily", time) &&
      (!completed ||
        latestDue(daily, dailyOffsets, timestamp, Date.parse(completed)) !==
          undefined)
    )
      return sync.start("daily");
    if (paste) {
      const slot = Math.floor(timestamp / hour) * hour;
      const hourInCairo = Number(
        new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          hourCycle: "h23",
          timeZone: timezone,
        }).format(time),
      );
      const last = lastRun(db, "attendance");
      const withinHours =
        paste.startHour < paste.endHour
          ? hourInCairo >= paste.startHour && hourInCairo < paste.endHour
          : hourInCairo >= paste.startHour || hourInCairo < paste.endHour;
      if (withinHours && (!last || Date.parse(last.startedAt) < slot))
        return sync.start("attendance");
    }
  }

  const backupOffsets = cronOffsets(backupPattern);
  const daily = cron.schedule(config.jobs.daily, () => void check(), options);
  const attendance = paste
    ? cron.schedule("0 * * * *", () => void check(), options)
    : undefined;
  const backup = cron.schedule(backupPattern, () => void check(), options);
  const weekly = cron.schedule(
    config.jobs.weekly,
    () => void sync.start("roster"),
    { ...options, timezone: config.timezone },
  );
  const timer = setInterval(check, 15 * 60_000);
  return {
    check,
    stop() {
      clearInterval(timer);
      for (const task of [daily, backup, weekly, attendance])
        if (task) void task.destroy();
    },
  };
}
