import { readSettings } from "../v2/settings.js";
import { syncQueues, syncQa } from "../v2/sources.js";
import type { Config, SourceKey } from "../config.js";
import type { Env } from "../env.js";
import type { Db } from "../db/db.js";
import { mtdMismatchWarning, type Job } from "../api/dto.js";
import {
  agentsOf,
  attendanceOf,
  lastSuccess,
  saveAgent,
  scheduleOf,
} from "../db/repo.js";
import { fetchCsv } from "../fetch/fetchCsv.js";
import { readFixture } from "../fetch/fixtures.js";
import { fetchGoogleRows } from "../fetch/googleSheets.js";
import { loadSourceFile } from "../fetch/sourceFile.js";
import { sourceUrl } from "../fetch/urls.js";
import { parseMaster } from "../parse/master.js";
import { localDate, plusDays, weekday } from "../parse/normalize.js";
import { parseSchedule, type Window } from "../parse/schedule.js";
import { parseAttendance } from "../parse/attendance.js";
import { runRules } from "../rules/index.js";
import { jobRunner } from "./runJob.js";
import { rosterChanges } from "./syncRoster.js";
import { replaceSchedule } from "./syncSchedule.js";
import {
  summarizeAttendance,
  summarizeParsedAttendance,
} from "./attendancePreview.js";
import {
  attendancePastePreview,
  attendancePasteStale,
  loadAttendancePaste,
  mtdDailyMismatch,
  storeAttendancePaste,
} from "./attendancePaste.js";
import { coveredRange, replaceAttendance } from "./syncAttendance.js";

export function createSync(
  db: Db,
  config: Config,
  mode: Env["SOURCE_MODE"],
  now = () => new Date(),
  dataDir = ":memory:",
) {
  const runner = jobRunner(db, now, mode === "live");
  const usesPaste =
    mode === "live" &&
    config.sources.attendance.access === "google" &&
    !!config.sources.attendance.paste;
  const today = () => localDate(config.timezone, now());
  const window = (date = today()): Window => ({
    from: plusDays(date, -config.syncWindow.pastDays),
    to: plusDays(date, config.syncWindow.futureDays),
  });
  async function load(source: SourceKey, log = true) {
    const settings = config.sources[source];
    const result: {
      rows: string[][];
      rowsRead?: number;
      bytes?: number;
      archive?: () => void;
    } =
      mode === "fixture"
        ? readFixture(
            source,
            source === "attendance" &&
              config.sources.attendance.layout === "wide"
              ? "attendance-wide"
              : source,
          )
        : settings.access === "google"
          ? await fetchGoogleRows(config, source, dataDir)
          : settings.access === "file"
            ? await loadSourceFile(config, source, dataDir, agentsOf(db))
            : await fetchCsv(sourceUrl(settings));
    if (log)
      console.log(
        source +
          ": " +
          (result.bytes === undefined ? "" : result.bytes + " bytes, ") +
          (result.rowsRead ?? result.rows.length) +
          " rows",
      );
    return result;
  }
  const roster = (date: string) =>
    runner.runStep("roster", async () => {
      const { rows, archive } = await load("master");
      const { agents, warnings } = parseMaster(rows, config, date);
      const week = plusDays(date, -weekday(date));
      db.transaction(() => {
        const updates = rosterChanges(agentsOf(db), agents);
        const stamp = now().toISOString();
        for (const agent of updates.agents) saveAgent(db, agent, stamp);
        db.prepare("DELETE FROM roster_snapshots WHERE week_of=?").run(week);
        const snapshot = db.prepare(
          "INSERT INTO roster_snapshots VALUES (@week,@code,@dtl,@tl,@account)",
        );
        for (const agent of agents)
          if (agent.active) snapshot.run({ ...agent, week });
        const insert = db.prepare(
          "INSERT INTO roster_events (date,code,type,detail) VALUES (@date,@code,@type,@detail)",
        );
        for (const event of updates.events) insert.run({ ...event, date });
        archive?.();
      })();
      return { rowsRead: rows.length, rowsKept: agents.length, warnings };
    });
  const schedule = (range: Window) =>
    runner.runStep("schedule", async () => {
      const { rows, archive } = await load("schedule");
      const { records, warnings, scheduledCodes, dates } = parseSchedule(
        rows,
        config,
        new Set(agentsOf(db).map((agent) => agent.code)),
        range,
      );
      if (!scheduledCodes.size) throw new Error("NO_TEAM_ROWS");
      if (!records.length) throw new Error("NO_SCHEDULE_DATES_IN_WINDOW");
      const covered = coveredRange(dates, range);
      db.transaction(() => {
        replaceSchedule(
          db,
          records,
          scheduledCodes,
          covered,
          now().toISOString(),
        );
        archive?.();
      })();
      return { rowsRead: rows.length, rowsKept: records.length, warnings };
    });
  const attendance = (date: string, range: Window) =>
    runner.runStep("attendance", async () => {
      if (usesPaste) {
        const paste = await loadAttendancePaste(config, dataDir, agentsOf(db));
        const { cycleStartDay } = readSettings(
          db,
          config.coachingCycleStartDay,
        );
        const changed = storeAttendancePaste(
          db,
          paste,
          date,
          now().toISOString(),
          cycleStartDay,
        );
        const mismatch = mtdDailyMismatch(
          db,
          paste,
          cycleStartDay,
          new Set(
            agentsOf(db)
              .filter((agent) => agent.ownerGroup === "mine")
              .map((agent) => agent.code),
          ),
        );
        return {
          rowsRead: paste.rowsRead,
          rowsKept: paste.records.length,
          warnings: [
            ...attendancePastePreview(paste, config, date).warnings,
            ...(changed ? [] : ["no change"]),
            ...(mismatch.length
              ? [mtdMismatchWarning + mismatch.join(",")]
              : []),
          ],
        };
      }
      const { rows, rowsRead, archive } = await load("attendance");
      const { records, matchedRows, warnings, dates, invalidDateRows } =
        parseAttendance(rows, config, agentsOf(db), range);
      if (archive && invalidDateRows)
        throw new Error(
          "Attendance CSV has invalid dates for team rows. Check the CSV and column mapping.",
        );
      if (!matchedRows) throw new Error("NO_TEAM_ROWS");
      if (!records.length) throw new Error("NO_ATTENDANCE_DATES_IN_WINDOW");
      const covered = coveredRange(dates, range);
      db.transaction(() => {
        replaceAttendance(db, records, covered, now().toISOString());
        archive?.();
      })();
      return {
        rowsRead: rowsRead ?? rows.length,
        rowsKept: records.length,
        warnings:
          config.sources.attendance.access === "public"
            ? warnings
            : warnings.map((warning) =>
                warning.startsWith("UNMATCHED_ATTENDANCE_NAME:")
                  ? warning.split(/\s+/)[0]
                  : warning,
              ),
      };
    });
  const rules = (date: string, range: Window) =>
    runner.runStep("rules", () => {
      const schedule = scheduleOf(db, { ...range, to: plusDays(date, 7) });
      const attendance = attendanceOf(db, { ...range, to: date });
      const scheduleMembers = lastSuccess(db, "schedule")
        ? new Set(
            (
              db.prepare("SELECT code FROM schedule_members").all() as {
                code: string;
              }[]
            ).map((row) => row.code),
          )
        : null;
      const counts = db.transaction(() =>
        runRules(
          db,
          {
            agents: agentsOf(db),
            today: date,
            from: range.from,
            schedule,
            attendance,
            scheduleMembers,
            attendanceEnabled: config.sources.attendance.enabled,
          },
          now().toISOString(),
        ),
      )();
      return {
        rowsRead: schedule.length + attendance.length,
        rowsKept: counts,
        warnings: [],
      };
    });
  function start(job: Job) {
    return runner.start(job, async () => {
      const date = today();
      const range = window(date);
      if (job === "roster")
        return (await roster(date)) && (await rules(date, range));
      if (job === "attendance")
        return (
          usesPaste &&
          config.sources.attendance.enabled &&
          (await attendance(date, range)) &&
          (await rules(date, range))
        );
      const success = lastSuccess(db, "roster");
      if (
        job === "all" ||
        !success ||
        now().getTime() - Date.parse(success) > 7 * 86400000
      ) {
        if (!(await roster(date))) return false;
      }
      if (!(await schedule(range))) return false;
      if (
        config.sources.attendance.enabled &&
        (!usesPaste || job === "all") &&
        !(await attendance(date, range))
      )
        return false;
      const ruled = await rules(date, range);
      // Optional sources run last so a failure there never holds back
      // attendance or the rules. The run is still reported as failed.
      const optional = await optionalSources();
      return ruled && optional;
    });
  }
  async function optionalSources() {
    let ok = true;
    if (config.sources.lineQueue?.enabled)
      ok = await runner.runStep("lineQueue", () =>
        syncQueues(db, config, mode, now()),
      );
    if (config.sources.qa?.enabled)
      ok = (await runner.runStep("qa", () => syncQa(db, config, mode))) && ok;
    return ok;
  }
  let previewPending: ReturnType<typeof previewAttendance> | undefined;
  async function previewAttendance() {
    if (!agentsOf(db).length)
      throw new Error("Sync the roster before the dry run");
    const source = config.sources.attendance;
    if (usesPaste) {
      const date = today(),
        range = window(date);
      const paste = await loadAttendancePaste(config, dataDir, agentsOf(db));
      const summary = attendancePastePreview(
        paste,
        {
          ...config,
          coachingCycleStartDay: readSettings(db, config.coachingCycleStartDay)
            .cycleStartDay,
        },
        date,
      );
      return db.transaction(() => ({
        ...summarizeParsedAttendance(
          db,
          { ...summary, records: paste.records, dates: paste.dates },
          config,
          date,
          range,
          true,
        ),
        ...summary,
      }))();
    }
    if (mode === "live" && source.access !== "file" && !source.sheetId)
      throw new Error("Configure an attendance source before the dry run");
    const { rows } = await load("attendance", false).catch((error: unknown) => {
      if (source.access !== "public") throw error;
      throw new Error(
        "Could not read the attendance CSV. Check the source link and tab.",
      );
    });
    const date = today();
    return db.transaction(() =>
      summarizeAttendance(db, rows, config, date, window(date)),
    )();
  }
  return {
    previewAttendance() {
      previewPending ??= previewAttendance().finally(() => {
        previewPending = undefined;
      });
      return previewPending;
    },
    start,
    attendancePasteEnabled: usesPaste && config.sources.attendance.enabled,
    attendanceStale: () =>
      usesPaste &&
      config.sources.attendance.enabled &&
      attendancePasteStale(db, now()),
    today,
    window,
    get active() {
      return runner.active;
    },
  };
}
export type SyncService = ReturnType<typeof createSync>;
