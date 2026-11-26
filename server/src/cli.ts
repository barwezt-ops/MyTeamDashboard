import bcrypt from "bcrypt";
import { loadConfig } from "./config.js";
import { readBackup, writeBackup } from "./backup/files.js";
import { restoreBackup } from "./backup/data.js";
import { readDataDir, readEnv } from "./env.js";
import { openDb, openExistingDbReadOnly } from "./db/db.js";
import { checkSheetLink, sourceKeys } from "./fetch/checkLink.js";
import { createSync } from "./sync/service.js";
import { createInterface } from "node:readline/promises";
import { googleLogin, googleLogout } from "./fetch/googleAuth.js";
import { pasteTabs, readAttendancePasteTabs } from "./fetch/attendancePaste.js";
import { attendancePasteStatusMap } from "./parse/status.js";

async function hashPassword() {
  const input = createInterface({ input: process.stdin, terminal: false });
  process.stderr.write("Enter dashboard password (input may be visible): ");
  for await (const password of input) {
    input.close();
    if (!password || Buffer.byteLength(password) > 72)
      throw new Error("Enter a password between 1 and 72 UTF-8 bytes");
    console.log(await bcrypt.hash(password, 12));
    return;
  }
  throw new Error("Password input is required");
}
try {
  if (process.argv[2] === "hash-password") await hashPassword();
  else if (process.argv[2] === "google-login") {
    await googleLogin(
      readDataDir(),
      undefined,
      undefined,
      process.argv.includes("--drive-readonly"),
    );
    console.log("Google sign-in saved.");
  } else if (process.argv[2] === "google-logout") {
    await googleLogout(readDataDir());
    console.log("Google sign-in removed.");
  } else if (
    process.argv[2] === "test-link" &&
    process.argv[3] === "--paste-tabs"
  ) {
    const paste = loadConfig(undefined, "live", true).sources.attendance.paste;
    if (!paste)
      throw new Error("Configure the private attendance paste workbook.");
    const tabs = await readAttendancePasteTabs(
      paste.sheetId,
      readDataDir(),
      [...pasteTabs],
      true,
    );
    console.log(
      JSON.stringify(
        tabs.map(({ tab, headers, rows }) => ({
          tab,
          headers,
          rowCount: rows.length,
        })),
        null,
        2,
      ),
    );
  } else if (process.argv[2] === "test-link") {
    const link = process.argv[3];
    if (!link) throw new Error("Pass a Google Sheets view link");
    const config = loadConfig(
      undefined,
      process.env.SOURCE_MODE === "live" ? "live" : "fixture",
      true,
    );
    const selected = process.argv
      .find((arg) => arg.startsWith("--source="))
      ?.slice("--source=".length);
    const source = sourceKeys.find((key) => key === selected);
    if (selected !== undefined && !source)
      throw new Error(
        "Pass --source=master, --source=schedule or --source=attendance",
      );
    const access = process.argv
      .find((arg) => arg.startsWith("--access="))
      ?.slice("--access=".length);
    if (access !== undefined && access !== "public" && access !== "google")
      throw new Error("Pass --access=public or --access=google");
    const directory =
      access === "google" ||
      (access !== "public" &&
        sourceKeys.some((key) => config.sources[key].access === "google"))
        ? readDataDir()
        : undefined;
    const report = await checkSheetLink(
      { link, source, access },
      config,
      fetch,
      directory,
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.error || report.mismatches.length) process.exitCode = 1;
  } else if (process.argv[2] === "backup" || process.argv[2] === "restore") {
    const command = process.argv[2];
    const path = process.argv[3];
    if (command === "restore" && !path)
      throw new Error("Pass a JSON backup file");
    const backup = command === "restore" ? readBackup(path) : null;
    const directory = readDataDir();
    const db = openDb(directory);
    try {
      if (backup) {
        restoreBackup(db, backup);
        console.log("Backup restored");
      } else console.log(writeBackup(db, directory));
    } finally {
      db.close();
    }
  } else if (process.argv[2] === "sync") {
    const job = process.argv[3]?.replace(/^--job=/, "");
    const dryRun = process.argv.includes("--dry-run");
    if (
      dryRun
        ? job !== "attendance"
        : job !== "roster" && job !== "daily" && job !== "all"
    )
      throw new Error(
        "Pass --job=roster, --job=daily, --job=all, or --job=attendance --dry-run",
      );
    const env = readEnv();
    const config = loadConfig(undefined, env.SOURCE_MODE);
    if (dryRun && process.argv.includes("--paste")) {
      if (env.SOURCE_MODE !== "live" || !config.sources.attendance.paste)
        throw new Error(
          "Configure the private attendance paste workbook in live mode.",
        );
      config.sources.attendance.access = "google";
      config.statusMap = { ...attendancePasteStatusMap, ...config.statusMap };
    }
    const db = dryRun
      ? openExistingDbReadOnly(env.DATA_DIR)
      : openDb(env.DATA_DIR);
    try {
      const sync = createSync(
        db,
        config,
        env.SOURCE_MODE,
        undefined,
        env.DATA_DIR,
      );
      if (dryRun) {
        const report = await sync.previewAttendance();
        if (process.argv.includes("--paste")) delete report.flaggedFirstNames;
        console.log(JSON.stringify(report, null, 2));
      } else if (job === "roster" || job === "daily" || job === "all") {
        if (!(await sync.start(job))) process.exitCode = 1;
      }
    } finally {
      db.close();
    }
  } else throw new Error("Unknown command");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
