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
import { lastDailyStart, lastRun } from "../db/repo.js";
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
  const dailyFields = cron.parse(config.jobs.daily);

  // Cairo's UTC offsets are whole hours. Check allowed minutes/seconds with
  // node-cron's matcher so weekday restrictions and DST still apply.
  function due(
    task: ReturnType<typeof cron.createTask>,
    fields: typeof dailyFields,
    date: string,
    time: Date,
  ) {
    const second = Math.min(...fields.second) * 1000;
    const currentHour = Math.floor(time.getTime() / hour) * hour;
    for (
      let start = currentHour;
      start >= currentHour - 24 * hour;
      start -= hour
    ) {
      if (localDate(timezone, new Date(start)) !== date) break;
      for (const minute of fields.minute) {
        const candidate = new Date(start + minute * 60_000 + second);
        if (candidate <= time && task.match(candidate)) return true;
      }
    }
    return false;
  }

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
    const date = localDate(timezone, time);
    if (
      directory !== ":memory:" &&
      !existsSync(join(directory, "backups", backupName(time))) &&
      due(backup, backupFields, date, time) &&
      canRetry("backup", time)
    )
      runNightlyBackup(db, directory, time);

    const latest = lastDailyStart(db);
    if (latest && localDate(timezone, new Date(latest)) === date) return;
    if (due(daily, dailyFields, date, time) && canRetry("daily", time))
      return sync.start("daily");
  }

  const backupFields = cron.parse(backupPattern);
  const daily = cron.schedule(config.jobs.daily, () => void check(), options);
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
      for (const task of [daily, backup, weekly]) void task.destroy();
    },
  };
}
