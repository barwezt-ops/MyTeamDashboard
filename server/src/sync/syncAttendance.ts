import type { Db } from "../db/db.js";
import type { AttendanceDay } from "../api/dto.js";
import type { Window } from "../parse/schedule.js";
export function replaceAttendance(
  db: Db,
  records: AttendanceDay[],
  covered: Window,
  now: string,
) {
  db.prepare("DELETE FROM attendance_days WHERE date BETWEEN ? AND ?").run(
    covered.from,
    covered.to,
  );
  const insert = db.prepare(
    "INSERT INTO attendance_days VALUES (@code,@date,@raw,@status,@missing,@now)",
  );
  for (const row of records) insert.run({ ...row, now });
}
