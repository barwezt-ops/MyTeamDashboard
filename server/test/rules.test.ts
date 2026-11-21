import { expect, it } from "vitest";
import type { Status } from "../src/api/dto.js";
import type { RuleContext } from "../src/rules/context.js";
import { d1 } from "../src/rules/d1.js";
import { d2 } from "../src/rules/d2.js";
import { d3 } from "../src/rules/d3.js";
import { d4 } from "../src/rules/d4.js";
import { d5 } from "../src/rules/d5.js";
import { d6 } from "../src/rules/d6.js";
import { d7 } from "../src/rules/d7.js";
import { runRules } from "../src/rules/index.js";
import { openDb } from "../src/db/db.js";
import { sampleMaster, today, window } from "./sample.js";

const prev = "2026-11-20";
const make = (code: string, status: Status, date = today) => ({
  code,
  status,
  date,
  raw: status === "Unknown" ? "" : status,
  shiftStart: status === "Scheduled" ? "15:45" : null,
});
function context(): RuleContext {
  const { agents } = sampleMaster();
  return {
    agents,
    today,
    from: window.from,
    scheduleMembers: new Set([
      "99001",
      "99002",
      "99003",
      "99005",
      "99006",
      "99008",
    ]),
    attendanceEnabled: true,
    schedule: [
      make("99001", "Scheduled"),
      make("99002", "Scheduled"),
      make("99003", "PTO"),
      make("99005", "Unknown"),
      make("99006", "Not Hired"),
      make("99001", "Sick", prev),
      make("99001", "Scheduled", "2026-11-22"),
      make("99008", "Unknown", "2026-11-22"),
    ],
    attendance: [
      { ...make("99001", "Casual"), missing: "Missing hours" },
      { ...make("99003", "Present"), missing: null },
      { ...make("99006", "Absent"), missing: "Skip" },
    ],
  };
}
it("evaluates D1 through D7 with date and exclusion guards", () => {
  const ctx = context();
  expect(d1(ctx).map((row) => row.code)).toEqual(["99002"]);
  expect(d1({ ...ctx, attendance: [] })).toEqual([]);
  expect(d2(ctx)[0]?.missing).toBe(
    "Schedule shows 15:45, attendance shows Casual",
  );
  expect(d3(ctx)[0]?.code).toBe("99003");
  expect(d4(ctx).map((row) => row.missing)).toEqual(["Missing hours"]);
  expect(d5(ctx).map((row) => [row.code, row.missing])).toEqual([
    ["99004", "Not on schedule"],
    ["99008", "On schedule but not on team roster"],
  ]);
  expect(d5({ ...ctx, scheduleMembers: null })).toEqual([]);
  expect(d6(ctx).map((row) => row.code)).toEqual(["99005"]);
  expect(d7(ctx)[0]).toMatchObject({
    severity: "info",
    missing: "Confirm return (was Sick yesterday)",
  });
  expect(
    d7({
      ...ctx,
      attendance: [
        ...ctx.attendance,
        { ...make("99001", "On Hold", prev), missing: null },
      ],
    }),
  ).toEqual([]);
});
it("dedupes findings, keeps comments and resolves only open findings when corrected", () => {
  const db = openDb(":memory:");
  const ctx = context();
  expect(runRules(db, ctx, today)).toBe(8);
  expect(runRules(db, ctx, today)).toBe(8);
  expect(db.prepare("SELECT count(*) AS n FROM discrepancies").get()).toEqual({
    n: 8,
  });
  db.prepare(
    "UPDATE discrepancies SET tl_comment='recorded' WHERE rule_id='D6'",
  ).run();
  db.prepare("UPDATE discrepancies SET state='ack' WHERE rule_id='D7'").run();
  runRules(
    db,
    {
      ...ctx,
      schedule: [],
      attendance: [],
      attendanceEnabled: false,
      scheduleMembers: null,
    },
    today,
  );
  expect(
    db
      .prepare(
        "SELECT state,tl_comment,auto_cleared FROM discrepancies WHERE rule_id='D6'",
      )
      .get(),
  ).toEqual({ state: "resolved", tl_comment: "recorded", auto_cleared: 1 });
  expect(
    db.prepare("SELECT state FROM discrepancies WHERE rule_id='D7'").get(),
  ).toEqual({ state: "ack" });
  db.close();
});
