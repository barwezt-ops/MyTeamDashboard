import type { Db } from "../db/db.js";
import type { ScheduleDay } from "../api/dto.js";
import type { Window } from "../parse/schedule.js";
export function replaceSchedule(
  db: Db,
  records: ScheduleDay[],
  members: Set<string>,
  window: Window,
  now: string,
) {
  db.prepare("DELETE FROM schedule_days WHERE date BETWEEN ? AND ?").run(
    window.from,
    window.to,
  );
  db.prepare("DELETE FROM schedule_members").run();
  const member = db.prepare("INSERT INTO schedule_members (code) VALUES (?)");
  for (const code of members) member.run(code);
  const insert = db.prepare(
    "INSERT INTO schedule_days VALUES (@code,@date,@raw,@status,@shiftStart,@now)",
  );
  for (const row of records) insert.run({ ...row, now });
}
