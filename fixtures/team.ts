// A synthetic team of sixteen with two cycles of history, used by the V2 screen
// tests and screenshots. Every name, code and number here is invented.
import type { Db } from "../server/src/db/db.js";
import { datesBetween } from "../server/src/v2/cycle.js";
import { saveSettings, readSettings } from "../server/src/v2/settings.js";
import { storeQueues } from "../server/src/v2/sources.js";
import { parseStatus } from "../server/src/parse/status.js";
import { weekday } from "../server/src/parse/normalize.js";
import {
  fixtureConfig,
  seedAgents,
  seedAttendance,
  type FakeDay,
} from "./v2.js";

export const TEAM_TODAY = "2026-11-26";
export const TEAM_NOW = TEAM_TODAY + "T12:00:00Z";

const names = [
  "Avery",
  "Jordan",
  "Riley",
  "Casey",
  "Morgan",
  "Taylor",
  "Quinn",
  "Drew",
  "Rowan",
  "Sage",
  "Harper",
  "Emery",
  "Parker",
  "Reese",
  "Skyler",
  "Finley",
];
const surnames =
  "Stone Brook Vale Hart Lane Frost Reed Cole Birch Moss Wren Ash Park Field Cross Hale".split(
    " ",
  );
export const teamCodes = names.map((_, i) => String(99101 + i));
const lineOf = (i: number) =>
  i < 6 ? "Inbound A" : i < 11 ? "Inbound B" : "Callbacks";
const shiftOf = (i: number) => (i < 11 ? "15:45" : "15:00");

// Two days off a week. Chosen so most of the team works on the fixture day.
const offDays = (i: number) => {
  if (i === 15) return [4, 5]; // off on the fixture Thursday
  if (i === 10) return [0, 1];
  return [
    [5, 6],
    [6, 0],
    [0, 1],
    [1, 2],
    [2, 3],
  ][i % 5];
};

/** Date-specific schedule entries that replace the weekly pattern. */
const leave: Record<string, Record<string, string>> = {
  "99111": {
    "2026-11-25": "Annual",
    "2026-11-26": "Annual",
    "2026-11-27": "Annual",
    "2026-11-28": "Annual",
  },
  "99106": { "2026-11-25": "Sick", "2026-12-02": "Annual" },
  "99114": { "2026-12-05": "Annual", "2026-12-06": "Annual" },
};

type Event = Partial<FakeDay>;
// This cycle's exceptions. The last five days drive the Home screen.
const events: Record<string, Record<string, Event>> = {
  "99101": {
    "21": { late: 6 },
    "22": { late: 8 },
    "24": { late: 8 },
    "25": { late: 16 },
  },
  "99102": {
    "21": { missing: 22 },
    "23": { missing: 18 },
    "25": { missing: 32, breakExceeded: true, breakMinutes: 11 },
  },
  "99103": { "25": { late: 8, missing: 8 } },
  "99104": {
    "23": { breakExceeded: true, breakMinutes: 4 },
    "24": { breakExceeded: true, breakMinutes: 9 },
    "25": { breakExceeded: true, breakMinutes: 76 },
  },
  "99106": { "22": { late: 12 } },
  "99110": { "24": { late: 5 }, "25": { late: 7, breakExceeded: true } },
  "99112": { "23": { missing: 41 } },
};
const clean = new Set(["99105", "99109", "99113", "99114", "99115"]);

export function seedTeam(db: Db) {
  const config = fixtureConfig();
  seedAgents(
    db,
    teamCodes.map((code, i) => [code, `${names[i]} ${surnames[i]}`]),
  );
  db.prepare(
    "UPDATE agents SET hire_date='2026-10-04' WHERE code='99115'",
  ).run();

  storeQueues(
    db,
    teamCodes.map((code, i) => ({
      code,
      line: code === "99108" ? "Inbound A" : lineOf(i),
      account: "Support",
      template: Array.from({ length: 7 }, (_, day) =>
        offDays(i).includes(day) ? "OFF" : shiftOf(i),
      ),
    })),
    new Date("2026-10-18T10:00:00Z"),
    config.timezone,
  );
  storeQueues(
    db,
    [
      {
        code: "99108",
        line: "Inbound B",
        account: "Support",
        template: Array.from({ length: 7 }, (_, day) =>
          offDays(7).includes(day) ? "OFF" : shiftOf(7),
        ),
      },
    ],
    new Date("2026-11-10T10:00:00Z"),
    config.timezone,
  );

  const schedule = db.prepare(
    "INSERT OR REPLACE INTO schedule_days VALUES (?,?,?,?,?,?)",
  );
  const member = db.prepare(
    "INSERT OR IGNORE INTO schedule_members VALUES (?)",
  );
  const attendance: FakeDay[] = [];
  teamCodes.forEach((code, i) => {
    member.run(code);
    for (const date of datesBetween("2026-09-21", "2026-12-10")) {
      const raw =
        leave[code]?.[date] ??
        (offDays(i).includes(weekday(date)) ? "OFF" : shiftOf(i));
      const parsed = parseStatus(raw, config.statusMap);
      if (date >= "2026-10-21")
        schedule.run(
          code,
          date,
          raw,
          parsed.status,
          parsed.shiftStart,
          TEAM_NOW,
        );
      if (date >= TEAM_TODAY) continue;
      const current = date >= "2026-11-21";
      const event = current ? events[code]?.[date.slice(8)] : undefined;
      // An agreed exception replaces the weekly day off.
      if (raw === "OFF" && !event) {
        attendance.push({ code, date, status: "Off" });
        continue;
      }
      if (raw === "Annual" || raw === "Sick") {
        attendance.push({ code, date, status: raw });
        continue;
      }
      // Earlier cycles get a light, repeatable spread of lateness.
      const seed =
        (i * 31 + Number(date.slice(8)) * 7 + Number(date.slice(5, 7))) % 19;
      attendance.push({
        code,
        date,
        shift: shiftOf(i),
        login: event?.late
          ? `${shiftOf(i).slice(0, 2)}:${String(45 + (event.late % 15)).padStart(2, "0")}`
          : "14:56",
        ...(!current && !clean.has(code)
          ? {
              late: seed === 3 ? 4 + (i % 9) : 0,
              missing: seed === 11 ? 15 + i : 0,
              breakExceeded: seed === 7,
            }
          : {}),
        ...event,
      });
    }
  });
  seedAttendance(db, attendance, TEAM_TODAY);

  const coaching = db.prepare(
    "INSERT INTO coachings(id,code,date,type,reasons,evidence,what_happened,what_was_said,next_step,acknowledged,measure,target,created_at) VALUES (?,?,?,?,?,'[]',?,?,?,1,?,?,?)",
  );
  const followUp = db.prepare(
    "INSERT INTO coaching_followups(coaching_id,code,date,state) VALUES (?,?,?,?)",
  );
  const log = (
    id: number,
    code: string,
    date: string,
    type: string,
    reason: string,
    step: string,
    due: string | null = null,
    state = "open",
    measure = "none",
    target: number | null = null,
  ) => {
    coaching.run(
      id,
      code,
      date,
      type,
      JSON.stringify([reason]),
      "Reviewed the recorded facts together.",
      "Talked through what the record shows.",
      step,
      measure,
      target,
      date + "T14:00:00Z",
    );
    if (due) followUp.run(id, code, due, state);
  };
  log(
    1,
    "99103",
    "2026-11-19",
    "corrective",
    "attendance",
    "Logged in by 15:40",
    "2026-11-26",
    "open",
    "lateness",
    0,
  );
  log(
    2,
    "99105",
    "2026-11-22",
    "recognition",
    "recognition",
    "Share the call opening with the team",
  );
  log(
    3,
    "99107",
    "2026-11-21",
    "corrective",
    "quality",
    "Use the closing checklist",
    "2026-11-30",
  );
  log(
    4,
    "99107",
    "2026-11-24",
    "follow-up",
    "quality",
    "Keep using the checklist",
  );
  log(
    5,
    "99108",
    "2026-11-22",
    "recognition",
    "recognition",
    "Mentor one new starter",
  );
  log(
    6,
    "99108",
    "2026-11-25",
    "corrective",
    "behaviour",
    "Post break times in the team channel",
    "2026-12-01",
  );
  log(
    7,
    "99109",
    "2026-11-23",
    "recognition",
    "recognition",
    "Keep the same routine",
  );
  log(
    8,
    "99110",
    "2026-11-23",
    "corrective",
    "attendance",
    "Logged in before shift start",
    "2026-11-25",
    "open",
    "lateness",
    0,
  );
  log(
    9,
    "99112",
    "2026-11-24",
    "corrective",
    "attendance",
    "Tell the lead before leaving the queue",
    "2026-11-27",
    "open",
    "missing",
    0,
  );
  log(
    10,
    "99113",
    "2026-11-21",
    "recognition",
    "recognition",
    "Keep the same routine",
  );
  log(
    11,
    "99101",
    "2026-11-04",
    "corrective",
    "attendance",
    "Logged in by 15:45",
    "2026-11-11",
    "not kept",
    "lateness",
    1,
  );
  log(
    12,
    "99102",
    "2026-10-28",
    "follow-up",
    "attendance",
    "Message before any gap",
    "2026-11-04",
    "kept",
  );

  const qa = db.prepare(
    "INSERT INTO qa_evaluations(code,date,score,form) VALUES (?,?,?,'Sample form')",
  );
  teamCodes.forEach((code, i) => {
    for (const [n, date] of [
      "2026-10-08",
      "2026-10-28",
      "2026-11-05",
      "2026-11-12",
      "2026-11-23",
    ].entries()) {
      // One agent has had no evaluation since 12 November.
      if (code === "99106" && n === 4) continue;
      qa.run(code, date, 85 + ((i * 7 + n * 3) % 13) + (n === 4 ? 1 : 0));
    }
  });

  db.prepare(
    "INSERT INTO private_notes(code,date,body,tags,created_at,updated_at) VALUES ('99101','2026-11-20','Asked to move to the earlier shift when a slot opens.','[\"schedule\"]',?,?)",
  ).run(TEAM_NOW, TEAM_NOW);
  db.prepare(
    "INSERT INTO roster_events(date,code,type,detail) VALUES ('2026-10-25','99115','new','Joined the team')",
  ).run();

  saveSettings(db, {
    ...readSettings(db),
    // Owner settings invented for the fixture.
    missingDays: 3,
    missingWindowDays: 5,
    staffing: { "Inbound B": 5 },
  });

  const run = db.prepare(
    "INSERT INTO sync_log(job,started_at,finished_at,ok,rows_read,rows_kept,warnings) VALUES (?,?,?,1,16,16,'[]')",
  );
  for (const job of [
    "daily",
    "roster",
    "schedule",
    "attendance",
    "rules",
    "lineQueue",
    "qa",
    "backup",
  ])
    run.run(job, TEAM_TODAY + "T10:00:00Z", TEAM_TODAY + "T10:00:00Z");
}

/** Empties every table of a fixture database and seeds the team again. */
export function resetTeam(db: Db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .pluck()
    .all() as string[];
  db.pragma("foreign_keys = OFF");
  db.transaction(() => {
    for (const table of tables) db.prepare(`DELETE FROM ${table}`).run();
    seedTeam(db);
  })();
  db.pragma("foreign_keys = ON");
}

/** Source settings that make the fixture team look connected. */
export function teamConfig() {
  const config = fixtureConfig();
  config.sources.attendance.enabled = true;
  config.sources.lineQueue = {
    ...config.sources.lineQueue!,
    enabled: true,
    sheetId: "FakeQueue",
    gid: "0",
  };
  config.sources.qa = {
    ...config.sources.qa!,
    enabled: true,
    mappingApproved: true,
    sheetId: "FakeQa",
    gid: "0",
    columns: { code: "Code", date: "Date", score: "Score" },
  };
  return config;
}
