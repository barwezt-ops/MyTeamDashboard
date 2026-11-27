import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import bcrypt from "bcrypt";
import {
  performanceToday,
  seedPerformanceFixture,
} from "../../fixtures/performance.js";
import { loadConfig } from "../../server/dist.test/config.js";
import { openDb } from "../../server/dist.test/db/db.js";
import { createSync } from "../../server/dist.test/sync/service.js";
import { readEnv } from "../../server/dist.test/env.js";
import { seedV2Fixture } from "../../fixtures/v2.js";
import {
  resetTeam,
  seedTeam,
  teamConfig,
  TEAM_NOW,
} from "../../fixtures/team.js";
import { createApp } from "../../server/dist.test/index.js";

process.env.PORT = "3210";
process.env.DATA_DIR = ":memory:";
process.env.SOURCE_MODE = "fixture";
process.env.SESSION_SECRET = "synthetic-smoke-test-secret-123456789";
process.env.DASHBOARD_PASSWORD_HASH = await bcrypt.hash(
  "synthetic-smoke-password",
  4,
);
const diagnosticUrl =
  "https://docs.google.com/spreadsheets/d/FakeSheetToken/export?format=csv&gid=27";
globalThis.fetch = async (input) =>
  String(input) === diagnosticUrl
    ? new Response(readFileSync("fixtures/master.sample.csv", "utf8"), {
        headers: { "content-type": "text/csv" },
      })
    : new Response(null, { status: 404 });

const performanceDb = openDb(":memory:");
seedPerformanceFixture(performanceDb);
const config = loadConfig();
const performanceSync = createSync(
  performanceDb,
  config,
  "fixture",
  () => new Date(performanceToday + "T12:00:00Z"),
);
createApp(readEnv(), config, performanceDb, performanceSync).listen(
  3211,
  "127.0.0.1",
);

// A synthetic team of sixteen for the V2 screens.
const teamDb = openDb(":memory:");
seedTeam(teamDb);
const team = teamConfig();
createApp(
  readEnv(),
  team,
  teamDb,
  createSync(teamDb, team, "fixture", () => new Date(TEAM_NOW)),
).listen(3212, "127.0.0.1");

// Each V2 screen test starts from the same synthetic data.
const correctionsDb = openDb(":memory:");
seedTeam(correctionsDb);
createApp(
  readEnv(),
  team,
  correctionsDb,
  createSync(correctionsDb, team, "fixture", () => new Date(TEAM_NOW)),
).listen(3213, "127.0.0.1");
createServer((request, response) => {
  if (request.method === "POST" && request.url === "/reset") resetTeam(teamDb);
  if (request.method === "POST" && request.url === "/corrections-fixture") {
    resetTeam(correctionsDb);
    correctionsDb
      .prepare(
        "INSERT INTO attendance_sheet_comments VALUES ('99106','2026-11-22','Active - Site, Annual or Sick',NULL,NULL,2)",
      )
      .run();
    // Fake review case only; production has no fixture routes.
    correctionsDb
      .prepare(
        "UPDATE attendance_days SET raw='NCNS',status='Absent',missing='08:00:00' WHERE code='99105' AND date='2026-11-25'",
      )
      .run();
    correctionsDb
      .prepare(
        "INSERT INTO attendance_sheet_comments VALUES ('99105','2026-11-25','Forced Annual approved for this day.','forced annual','PTO',0)",
      )
      .run();
    correctionsDb
      .prepare(
        "INSERT INTO attendance_sheet_comments VALUES ('99103','2026-11-25','Transport delay reported to the lead.',NULL,NULL,1)",
      )
      .run();
  }
  response.writeHead(204).end();
}).listen(3219, "127.0.0.1");

const db = openDb(":memory:");
const fixtureConfig = loadConfig();
fixtureConfig.sources.lineQueue = {
  enabled: true,
  access: "public",
  mode: "export",
  label: "Sample queues",
  sheetId: "FakeQueue",
  gid: "0",
  tab: "Sample queues",
  headerRows: 1,
};
const sync = createSync(
  db,
  fixtureConfig,
  "fixture",
  () => new Date("2026-11-21T12:00:00Z"),
);
createApp(readEnv(), fixtureConfig, db, sync).listen(3210, "127.0.0.1");
if (!(await sync.start("all"))) process.exit(1);

seedV2Fixture(db);
