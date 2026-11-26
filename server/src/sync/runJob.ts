import type { Job } from "../api/dto.js";
import type { Db } from "../db/db.js";

export interface JobResult {
  rowsRead: number;
  rowsKept: number;
  warnings: string[];
}
export function jobRunner(db: Db, now: () => Date, trackDaily = false) {
  let active: Job | null = null;
  async function runStep(
    name: string,
    action: () => Promise<JobResult> | JobResult,
  ) {
    const id = db
      .prepare("INSERT INTO sync_log (job,started_at) VALUES (?,?)")
      .run(name, now().toISOString()).lastInsertRowid;
    try {
      const result = await action();
      db.prepare(
        "UPDATE sync_log SET finished_at=?,ok=1,rows_read=?,rows_kept=?,warnings=? WHERE id=?",
      ).run(
        now().toISOString(),
        result.rowsRead,
        result.rowsKept,
        JSON.stringify(result.warnings),
        id,
      );
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected sync error";
      db.prepare(
        "UPDATE sync_log SET finished_at=?,ok=0,error=? WHERE id=?",
      ).run(now().toISOString(), message, id);
      console.error(name + ": " + message);
      return false;
    }
  }
  return {
    get active() {
      return active;
    },
    runStep,
    start(job: Job, action: () => Promise<boolean>) {
      if (active) return null;
      active = job;
      let dailyId: number | bigint | undefined;
      return Promise.resolve()
        .then(() => {
          if (trackDaily && (job === "daily" || job === "all")) {
            dailyId = db
              .prepare(
                "INSERT INTO sync_log (job,started_at) VALUES ('daily',?)",
              )
              .run(now().toISOString()).lastInsertRowid;
          }
          return action();
        })
        .catch((error) => {
          console.error(
            "Sync could not finish:",
            error instanceof Error ? error.message : "Unexpected error",
          );
          return false;
        })
        .then((ok) => {
          if (dailyId !== undefined)
            db.prepare(
              "UPDATE sync_log SET finished_at=?,ok=?,error=? WHERE id=?",
            ).run(
              now().toISOString(),
              Number(ok),
              ok
                ? null
                : "Daily sync failed. Check the individual job results.",
              dailyId,
            );
          return ok;
        })
        .finally(() => {
          active = null;
        });
    },
  };
}
