import { describe, expect, it } from "vitest";
import { configSchema } from "../src/config.js";
import { coveredConfig as loadConfig } from "./sample.js";
import { sampleSourceDate } from "../src/fetch/sampleDate.js";
import { checkColumns, indexOf } from "../src/parse/columns.js";
import { clean, codeOf, localDate, parseDate } from "../src/parse/normalize.js";
import { parseMaster } from "../src/parse/master.js";
import { parseStatus } from "../src/parse/status.js";
import { parseSchedule } from "../src/parse/schedule.js";
import { parseAttendance } from "../src/parse/attendance.js";
import { sample, sampleMaster, today, window } from "./sample.js";

describe("normalization and column selection", () => {
  it("preserves numeric strings and strips formulas and decimal suffixes", () => {
    expect(codeOf(" 01254.0 ")).toBe("01254");
    expect(clean("#REF!")).toBe("");
    expect(clean("#N/A")).toBe("");
    expect(indexOf("AA")).toBe(26);
    expect(indexOf("CN")).toBe(91);
    expect(() => checkColumns([["code"]], { date: "B" }, 0)).toThrow(
      "MISSING_REQUIRED_COLUMN:date",
    );
    expect(
      checkColumns(
        [
          ["code", "name"],
          ["1", ""],
          ["2", ""],
        ],
        { name: "B" },
        1,
      ),
    ).toEqual(["COLUMN_LOOKS_WRONG:name"]);
  });
  it.each(["2026-11-21", "11/21/2026", "21-Nov", "Nov-21"])(
    "reads %s",
    (value) => expect(parseDate(value, { window })).toBe(today),
  );
  it.each([
    ["July 6, 2026", "2026-07-06"],
    ["December 15, 2025", "2025-12-15"],
    ["Jul 6, 2026", "2026-07-06"],
    ["6 July 2026", "2026-07-06"],
    ["jULY 6 2026", "2026-07-06"],
    ["6 JUL, 2026", "2026-07-06"],
    ["February 29, 2024", "2024-02-29"],
    ["February 29, 2026", null],
    ["Julian 6, 2026", null],
  ])(
    "reads month-name date %s independently of slash date order",
    (value, expected) => {
      expect(parseDate(value, { dateOrder: "MDY" })).toBe(expected);
      expect(parseDate(value, { dateOrder: "DMY" })).toBe(expected);
    },
  );
  it("rejects bad and ambiguous dates and can ignore the source year", () => {
    expect(parseDate("2/29/2026")).toBeNull();
    expect(parseDate("n/a")).toBeNull();
    expect(parseDate("Nov-21")).toBeNull();
    expect(
      parseDate("21-Nov", { window: { from: "2025-11-21", to: "2026-11-21" } }),
    ).toBeNull();
    expect(parseDate("11/21/1990", { window, ignoreYear: true })).toBe(today);
    expect(parseDate("November 21, 1990", { window, ignoreYear: true })).toBe(
      today,
    );
    expect(localDate("Africa/Cairo", new Date("2026-11-20T23:00:00Z"))).toBe(
      today,
    );
  });
});

describe("roster", () => {
  it("parses month names in both master date fields", () => {
    const config = loadConfig();
    config.dateOrder = "DMY";
    const rows = sample("master").slice(0, 2);
    rows[1][indexOf(config.sources.master.columns.hireDate)] = "July 6, 2026";
    rows[1][indexOf(config.sources.master.columns.lastWorkingDay)] =
      "December 15, 2025";
    expect(parseMaster(rows, config, today).agents[0]).toMatchObject({
      hireDate: "2026-07-06",
      lastWorkingDay: "2025-12-15",
      active: false,
    });
  });

  it("dedupes codes, normalizes leadership, and drops private fields in both layouts", () => {
    const { agents, warnings } = sampleMaster();
    expect(agents.map((row) => row.code)).toEqual([
      "99001",
      "99002",
      "99003",
      "99004",
      "99005",
      "99006",
      "99008",
    ]);
    expect(agents[0]).toMatchObject({
      fullName: "Avery Sample",
      firstName: "Avery",
      ownerGroup: "mine",
    });
    expect(agents[1].account2).toBe("");
    expect(agents[2].ownerGroup).toBe("covered");
    expect(agents.at(-1)?.active).toBe(false);
    expect(warnings).toContain("DUPLICATE_CODES_DROPPED:1");
    expect(JSON.stringify(agents)).not.toMatch(
      /555-0100|example.invalid|FAKE-LAPTOP|Synthetic Alias/,
    );
    const config = loadConfig();
    config.sources.master.headerRows = 0;
    expect(
      parseMaster(sample("master-no-header"), config, today).agents,
    ).toEqual(agents);
  });
});

describe("schedule", () => {
  it.each([
    ["15:45", "Scheduled"],
    ["7:30", "Scheduled"],
    ["OFF", "Off Day"],
    ["Annual", "PTO"],
    ["PTO", "PTO"],
    ["UPL", "UPL"],
    [" Sick ", "Sick"],
    ["Casual", "Casual"],
    ["On Hold", "On Hold"],
    ["Not Hired", "Not Hired"],
    ["Present", "Present"],
    ["Absent", "Absent"],
    ["No show", "Absent"],
    ["", "Unknown"],
    ["#REF!", "Unknown"],
    ["#N/A", "Unknown"],
    ["#VALUE!", "Unknown"],
    ["constructor", "Unknown"],
  ])("normalizes %s", (raw, status) => {
    expect(parseStatus(raw, loadConfig().statusMap).status).toBe(status);
  });
  it("anchors 86 days, flags an anchor offset, ignores summaries and filters agents", () => {
    const rows = sample("schedule");
    const config = loadConfig();
    const codes = new Set(sampleMaster().agents.map((agent) => agent.code));
    const result = parseSchedule(rows, config, codes, window);
    expect(result.dates).toHaveLength(86);
    expect(result.dates.slice(0, 2)).toEqual(["2026-10-21", "2026-10-22"]);
    expect(result.dates.at(-1)).toBe("2027-01-14");
    expect(result.scheduledCodes.has("99007")).toBe(false);
    expect(result.scheduledCodes.has("99004")).toBe(false);
    expect(
      result.records.find((row) => row.date === today && row.code === "99005"),
    ).toMatchObject({ status: "Unknown", raw: "" });
    expect(result.warnings).not.toContain("ANCHOR_MISMATCH");
    config.sources.schedule.anchor.date = "2026-10-22";
    expect(parseSchedule(rows, config, codes, window).warnings).toContain(
      "ANCHOR_MISMATCH",
    );
    rows[0] = rows[0].slice(0, 91);
    expect(() => parseSchedule(rows, config, codes, window)).toThrow(
      "MISSING_SCHEDULE_STOP_HEADER",
    );
  });
});

describe("attendance", () => {
  it("parses the long layout and keeps configured missing text for team codes", () => {
    const config = loadConfig();
    const result = parseAttendance(
      sample("attendance"),
      config,
      sampleMaster().agents,
      window,
    );
    expect(result.records).toHaveLength(4);
    expect(result.records[0]).toMatchObject({
      code: "99001",
      date: today,
      status: "Sick",
      missing: "Missing punch",
    });
    const duplicate = [
      ...sample("attendance"),
      ["99001", "", "", "", "11/21/2026", "", "Missing hours"],
    ];
    expect(
      parseAttendance(duplicate, config, sampleMaster().agents, window)
        .records[0].missing,
    ).toBe("Missing punch\nMissing hours");
    delete config.sources.attendance.long.columns.missing;
    expect(
      parseAttendance(
        sample("attendance"),
        config,
        sampleMaster().agents,
        window,
      ).records[0].missing,
    ).toBeNull();
  });
  it("matches only unique normalized names and ignores the wide header year", () => {
    const config = loadConfig();
    config.sources.attendance.layout = "wide";
    const agents = sampleMaster().agents;
    const rows = sample("attendance-wide");
    const result = parseAttendance(rows, config, agents, window);
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({
      code: "99001",
      date: "2026-11-20",
      status: "Present",
    });
    expect(result.warnings).toEqual([]);
    const ambiguous = parseAttendance(
      rows,
      config,
      [...agents, { ...agents[0], code: "99999" }],
      window,
    );
    expect(
      ambiguous.records.some(
        (row) => row.code === "99001" || row.code === "99999",
      ),
    ).toBe(false);
    config.sources.attendance.wide.keyType = "code";
    expect(parseAttendance(rows, config, agents, window).records).toEqual([]);
  });
});

it.each([
  ["6:00 PM", "18:00"],
  ["6:00 pm", "18:00"],
  ["18:00:00", "18:00"],
  ["6:15 AM", "06:15"],
  ["12:00 PM", "12:00"],
  ["12:00 AM", "00:00"],
  ["6:00:45pm", "18:00"],
])("normalizes shift %s to %s", (raw, shiftStart) => {
  expect(parseStatus(raw, loadConfig().statusMap)).toEqual({
    status: "Scheduled",
    shiftStart,
  });
});

it.each(["24:00", "12:61", "18:00:60", "0:30 AM", "18:00 PM"])(
  "rejects invalid shift %s",
  (raw) =>
    expect(parseStatus(raw, loadConfig().statusMap)).toEqual({
      status: "Unknown",
      shiftStart: null,
    }),
);

it("reports unmatched wide attendance names only for configured team leads", () => {
  const config = loadConfig();
  config.sources.attendance.layout = "wide";
  config.sources.attendance.wide.dtlColumn = "A";
  const rows = [
    ["DTL", "Department", "Name", "21-Nov"],
    ["  DEMO   LEAD  ", "", "Own Missing", "Present"],
    ["cover lead", "", "Covered Missing", "Present"],
    ["Other Lead", "Demo Lead", "Outside Missing", "Present"],
    ["", "", "No Lead", "Present"],
  ];
  const parsed = parseAttendance(rows, config, sampleMaster().agents, window);
  expect(parsed.warnings).toEqual([
    "UNMATCHED_ATTENDANCE_NAME:Covered Missing",
    "UNMATCHED_ATTENDANCE_NAME:Own Missing",
  ]);
  expect(parsed.records).toEqual([]);
});

it("accepts a relocated master field and verifies the expected header", () => {
  const config = loadConfig();
  const rows = sample("master");
  const master = config.sources.master;
  const parsed = configSchema.parse({
    ...config,
    sources: {
      ...config.sources,
      master: {
        ...master,
        columns: { ...master.columns, name: "aa" },
        expectHeaders: { name: " Employee  Name " },
      },
    },
  });
  rows[0][26] = "employee name";
  rows[1][26] = "Relocated Sample";
  expect(parseMaster(rows, parsed, today).agents[0].fullName).toBe(
    "Relocated Sample",
  );
  rows[0][26] = "Different header";
  expect(() => parseMaster(rows, parsed, today)).toThrow(
    "COLUMN_HEADER_MISMATCH:name",
  );
  parsed.sources.master.headerRows = 0;
  expect(parseMaster(rows.slice(1), parsed, today).agents[0].fullName).toBe(
    "Relocated Sample",
  );
});

it.each([
  ["N", "Phone number"],
  ["O", "IWS Email"],
  ["Q", "Laptop Number"],
  ["L", "American Name"],
])(
  "rejects sensitive master header %s even when explicitly expected",
  (column, header) => {
    const config = loadConfig();
    const master = config.sources.master;
    master.columns.name = column;
    master.expectHeaders = { name: header };
    expect(() => parseMaster(sample("master"), config, today)).toThrow(
      "COLUMN_HEADER_MISMATCH:name",
    );
  },
);

it("uses configured slash date order for master and both attendance layouts", () => {
  expect(parseDate("11/12/2026")).toBe("2026-11-12");
  expect(parseDate("11/12/2026", { dateOrder: "DMY" })).toBe("2026-12-11");
  expect(parseDate("31/02/2026", { dateOrder: "DMY" })).toBeNull();
  expect(parseDate("2026-12-11", { dateOrder: "DMY" })).toBe("2026-12-11");
  const config = loadConfig();
  config.dateOrder = "DMY";
  const roster = sample("master");
  roster[1][0] = "21/11/2025";
  expect(parseMaster(roster, config, today).agents[0].hireDate).toBe(
    "2025-11-21",
  );

  const rows = sample("attendance").slice(0, 2);
  rows[1][4] = "21/11/2026";
  const agents = sampleMaster().agents;
  expect(parseAttendance(rows, config, agents, window).records[0].date).toBe(
    today,
  );
  config.sources.attendance.layout = "wide";
  const wide = sample("attendance-wide");
  wide[0][3] = "20/11/2024";
  expect(parseAttendance(wide, config, agents, window).records[0].date).toBe(
    "2026-11-20",
  );
});

it("provides one date sample per configured sheet mapping", () => {
  const config = loadConfig();
  config.dateOrder = "DMY";
  const now = new Date("2026-11-21T12:00:00Z");
  const roster = sample("master");
  roster[1][0] = "21/11/2025";
  const attendance = sample("attendance");
  attendance[1][4] = "21/11/2026";
  expect(sampleSourceDate(roster, config, "master", now)).toBe("2025-11-21");
  expect(sampleSourceDate(sample("schedule"), config, "schedule", now)).toBe(
    "2026-10-21",
  );
  expect(sampleSourceDate(attendance, config, "attendance", now)).toBe(today);
  config.sources.attendance.layout = "wide";
  expect(
    sampleSourceDate(sample("attendance-wide"), config, "attendance", now),
  ).toBe(today);
});
