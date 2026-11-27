import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import bcrypt from "bcrypt";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { coveredConfig as loadConfig } from "./sample.js";
import { openDb } from "../src/db/db.js";
import { attendanceOf, lastRun, saveAgent } from "../src/db/repo.js";
import { checkSheetLink } from "../src/fetch/checkLink.js";
import { decodeCsv, fetchCsv } from "../src/fetch/fetchCsv.js";
import { googleLogin, googleLogout } from "../src/fetch/googleAuth.js";
import { fetchGoogleRows } from "../src/fetch/googleSheets.js";
import {
  loadSourceFile,
  uploadAttendanceCsv,
} from "../src/fetch/sourceFile.js";
import { createApp } from "../src/index.js";
import { startLiveJobs } from "../src/sync/cron.js";
import { createSync } from "../src/sync/service.js";
import { syncLabel } from "../../web/src/components/ui.js";
import { sampleMaster } from "./sample.js";

const clientId = "fake-oauth-client";
const clientSecret = "fake-oauth-secret";
const refresh = "fake-refresh-token";
const access = "fake-access-token";
const scope = "https://www.googleapis.com/auth/spreadsheets.readonly";
const tokenName = "google-token.json";
const sheetId = "FakeAttendanceSheet";
const tab = "WFM's Template";
const link =
  "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit?gid=0";
const csv = readFileSync("fixtures/attendance.sample.csv", "utf8");
const rows = decodeCsv(csv);
const teamRows = rows.filter((row) => row[0] !== "99007");
const csvUpload = (value: string) => Readable.from([Buffer.from(value)]);
const fullCsv =
  csv
    .trimEnd()
    .split(/\r?\n/)
    .map(
      (row, index) =>
        row + "," + (index === 0 ? "WFM Comment" : "unmapped fixture detail"),
    )
    .join("\n") + "\n";
const master = readFileSync("fixtures/master.sample.csv", "utf8");
const schedule = readFileSync("fixtures/schedule.sample.csv", "utf8");
const now = () => new Date("2026-11-21T16:00:00Z");
let directory: string;
let inbox: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "dashboard-sources-"));
  vi.stubEnv("LOCALAPPDATA", directory);
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", clientId);
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", clientSecret);
  inbox = join(directory, "TeamDashboard", "inbox", "attendance");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function sourceConfig(mode: "google" | "file") {
  const config = loadConfig();
  Object.assign(config.sources.master, { sheetId: "FakeMaster", gid: "0" });
  Object.assign(config.sources.schedule, { sheetId: "FakeSchedule", gid: "0" });
  Object.assign(config.sources.attendance, {
    access: mode,
    sheetId,
    gid: "0",
    tab,
    enabled: true,
  });
  return config;
}

function seedToken() {
  writeFileSync(
    join(directory, tokenName),
    JSON.stringify({ refresh_token: refresh }),
    { mode: 0o600 },
  );
}

function googleMock(
  problem?: "expired" | "denied" | "admin" | "sensitive" | "patient",
) {
  return vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname === "docs.google.com")
      return new Response(
        url.pathname.includes("FakeMaster") ? master : schedule,
      );
    if (url.hostname === "oauth2.googleapis.com") {
      expect(
        new URLSearchParams(String(options?.body)).get("refresh_token"),
      ).toBe(refresh);
      return problem === "expired"
        ? Response.json(
            { error: "invalid_grant", error_description: refresh },
            { status: 400 },
          )
        : Response.json({ access_token: access, scope });
    }
    expect(url.hostname).toBe("sheets.googleapis.com");
    expect(url.searchParams.get("valueRenderOption")).toBe("FORMATTED_VALUE");
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      "Bearer " + access,
    );
    if (problem === "denied")
      return Response.json({ error: { message: access } }, { status: 403 });
    if (problem === "admin")
      return Response.json(
        { error: { message: "Blocked by your administrator." } },
        { status: 403 },
      );
    const range = decodeURIComponent(url.pathname.split("/values/")[1]);
    if (range === "'WFM''s Template'!A:B")
      return Response.json({ values: rows.map((row) => row.slice(0, 2)) });
    expect(range).toBe("'WFM''s Template'!E:G");
    const values = rows.map((row) => row.slice(4));
    if (problem === "sensitive") values[0][2] = "Phone number";
    if (problem === "patient") values[0][2] = "Patient name";
    return Response.json({ values });
  });
}

it("returns matching display rows from public, Google, and uploaded CSV", async () => {
  seedToken();
  const request = googleMock();
  const google = sourceConfig("google");
  const file = sourceConfig("file");
  const { agents } = sampleMaster();
  await uploadAttendanceCsv(csvUpload(fullCsv), file, directory, agents);
  expect(
    (
      await fetchCsv(
        link,
        vi.fn(async () => new Response(csv)),
      )
    ).rows,
  ).toEqual(rows);
  expect(
    (await fetchGoogleRows(google, "attendance", directory, request)).rows,
  ).toEqual(rows);
  expect(
    (await loadSourceFile(file, "attendance", directory, agents)).rows,
  ).toEqual(teamRows);
  const stored = readFileSync(join(inbox, readdirSync(inbox)[0]), "utf8");
  expect(stored).not.toMatch(/99007|unmapped fixture detail|WFM Comment/);
  expect(request).toHaveBeenCalledTimes(3);
  expect(google.sources.master.access).toBe("public");
  expect(google.sources.schedule.access).toBe("public");
});

it("checks only the configured Google link and hides sensitive headers and row values", async () => {
  seedToken();
  const config = sourceConfig("google");
  const input = { link, access: "google", source: "attendance" } as const;
  const request = googleMock("sensitive");
  const refused = await checkSheetLink(
    { ...input, gid: "7" },
    config,
    request,
    directory,
  );
  expect(refused.error).toContain("exact tab link");
  expect(request).not.toHaveBeenCalled();
  const report = await checkSheetLink(input, config, request, directory);
  expect(report).toMatchObject({
    rowCount: rows.length,
    sampleDate: "2026-11-21",
    error: null,
  });
  expect(report.headers).toContainEqual({
    field: "missing",
    column: "G",
    header: null,
  });
  expect(JSON.stringify(report)).not.toMatch(
    /Phone number|Avery|fake-oauth|fake-refresh|fake-access/,
  );
  const patient = await checkSheetLink(
    input,
    config,
    googleMock("patient"),
    directory,
  );
  expect(patient.error).toContain("Possible patient data");
  expect(patient.headers).toEqual([]);
});

it.each([
  ["missing", "Run npm run google-login"],
  ["expired", "Run npm run google-login"],
  ["denied", "Your account can't view this sheet"],
  ["admin", "Blocked by your administrator."],
] as const)(
  "reports %s without disclosing credentials or deleting stored attendance",
  async (problem, message) => {
    if (problem !== "missing") seedToken();
    const config = sourceConfig("google");
    const db = openDb(":memory:");
    const request = googleMock(problem === "missing" ? undefined : problem);
    vi.stubGlobal("fetch", request);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await createSync(db, config, "fixture", now).start("all")).toBe(
        true,
      );
      const sync = createSync(db, config, "live", now, directory);
      const before = attendanceOf(db, sync.window());
      expect(before.length).toBeGreaterThan(0);
      expect(await sync.start("daily")).toBe(false);
      await expect(sync.previewAttendance()).rejects.toThrow(message);
      const last = lastRun(db, "attendance");
      const report = await checkSheetLink({ link }, config, request, directory);
      expect(last).toMatchObject({ ok: false, error: message });
      expect(report.error).toBe(message);
      expect(attendanceOf(db, sync.window())).toEqual(before);
      expect(JSON.stringify([last, report, errorLog.mock.calls])).not.toMatch(
        /fake-oauth|fake-refresh|fake-access/,
      );
      expect(
        syncLabel({
          running: null,
          jobs: { attendance: { lastRun: last, lastSuccessAt: null } },
        } as Parameters<typeof syncLabel>[0]).tone,
      ).toBe("bad");
    } finally {
      db.close();
    }
  },
);

it("imports the newest drop, archives 14, and keeps attendance on a rejected CSV", async () => {
  const config = sourceConfig("file");
  vi.stubGlobal("fetch", googleMock());
  const db = openDb(":memory:");
  let time = new Date("2026-11-21T13:00:00Z");
  const clock = () => time;
  const sync = createSync(db, config, "live", clock, directory);
  const jobs = startLiveJobs(db, ":memory:", config, sync, clock);
  try {
    const processed = join(inbox, "processed");
    mkdirSync(processed, { recursive: true });
    for (let i = 0; i < 14; i++) {
      const path = join(
        processed,
        "2025-01-" + String(i + 1).padStart(2, "0") + ".csv",
      );
      writeFileSync(path, csv);
      utimesSync(path, 1, 1);
    }
    const older = join(inbox, "older.csv");
    writeFileSync(older, csv.replaceAll("Present", "Absent"));
    utimesSync(older, 2, 2);
    const newest = join(inbox, "full.csv");
    writeFileSync(newest, fullCsv);
    expect(await sync.start("roster")).toBe(true);
    time = new Date("2026-11-21T14:05:00Z");
    expect(await jobs.check()).toBe(true);
    const before = attendanceOf(db, sync.window());
    expect(before).toHaveLength(4);
    expect(before.some((record) => record.status === "Present")).toBe(true);
    expect(before.some((record) => record.code === "99007")).toBe(false);
    expect(readdirSync(inbox).sort()).toEqual(["older.csv", "processed"]);
    expect(readdirSync(processed)).toHaveLength(14);
    expect(readdirSync(processed)).not.toContain("2025-01-01.csv");
    const filtered = readdirSync(processed).find(
      (name) => !name.startsWith("2025-01-"),
    )!;
    expect(readFileSync(join(processed, filtered), "utf8")).not.toMatch(
      /99007|unmapped fixture detail|WFM Comment/,
    );
    expect(await sync.start("daily")).toBe(true);
    expect(attendanceOf(db, sync.window())).toEqual(before);
    const bad = join(inbox, "bad.csv");
    writeFileSync(bad, '"unclosed');
    utimesSync(bad, new Date(), new Date(Date.now() + 2000));
    expect(await sync.start("daily")).toBe(false);
    expect(lastRun(db, "attendance")?.error).toContain("Invalid CSV");
    expect(attendanceOf(db, sync.window())).toEqual(before);
    expect(readdirSync(inbox)).toContain("bad.csv");
    await expect(
      uploadAttendanceCsv(
        csvUpload(fullCsv.replace("WFM Comment", "Patient ID")),
        config,
        directory,
        sampleMaster().agents,
      ),
    ).rejects.toThrow("Possible patient data");
  } finally {
    jobs.stop();
    db.close();
  }
});

it("accepts an authenticated CSV upload without enabling attendance", async () => {
  const config = sourceConfig("file");
  config.sources.attendance.enabled = false;
  const db = openDb(":memory:");
  const { agents } = sampleMaster();
  for (const agent of agents) saveAgent(db, agent, now().toISOString());
  const password = "synthetic-dashboard-password";
  const sync = createSync(db, config, "live", now, directory);
  const app = createApp(
    {
      PORT: 3000,
      BIND_HOST: "127.0.0.1",
      DATA_DIR: directory,
      SOURCE_MODE: "live",
      TZ: "Africa/Cairo",
      DASHBOARD_PASSWORD_HASH: await bcrypt.hash(password, 4),
      SESSION_SECRET: "synthetic-source-access-session-secret",
    },
    config,
    db,
    sync,
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api";
  try {
    const upload = (data: string, cookie = "") =>
      fetch(base + "/attendance/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", Cookie: cookie },
        body: data,
      });
    expect((await upload(csv)).status).toBe(401);
    const login = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    expect(login.status).toBe(204);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const bad = await upload(csv.replace("Missing", "Patient_ID"), cookie);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({
      error: expect.stringContaining("Possible patient data"),
    });
    expect((await upload(fullCsv, cookie)).status).toBe(204);
    expect(
      (await loadSourceFile(config, "attendance", directory, agents)).rows,
    ).toEqual(teamRows);
    expect(config.sources.attendance.enabled).toBe(false);
    expect(attendanceOf(db, sync.window())).toEqual([]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

it.each([false, true])(
  "completes PKCE on loopback and revokes the private refresh token (Drive consent: %s)",
  async (withDrive) => {
    const drive = "https://www.googleapis.com/auth/drive.readonly";
    let challenge = "";
    const tokenEndpoint = vi.fn<typeof fetch>(async (input, options) => {
      const params = new URLSearchParams(String(options?.body));
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("client_id")).toBe(clientId);
      const verifier = params.get("code_verifier")!;
      expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
        challenge,
      );
      expect(params.get("code")).toBe("fixture-auth-code");
      return Response.json({
        access_token: access,
        refresh_token: refresh,
        scope: withDrive ? drive + " " + scope : scope,
      });
    });
    await googleLogin(
      directory,
      async (url) => {
        const auth = new URL(url);
        const query = auth.searchParams;
        expect(auth.hostname).toBe("accounts.google.com");
        expect(query.get("scope")).toBe(
          withDrive ? scope + " " + drive : scope,
        );
        expect(query.get("code_challenge_method")).toBe("S256");
        expect(query.get("access_type")).toBe("offline");
        expect(query.has("client_secret")).toBe(false);
        challenge = query.get("code_challenge")!;
        const callback = new URL(query.get("redirect_uri")!);
        expect(callback.hostname).toBe("127.0.0.1");
        expect(Number(callback.port)).toBeGreaterThan(0);
        callback.searchParams.set("code", "fixture-auth-code");
        expect((await fetch(callback)).status).toBe(400);
        callback.searchParams.set("state", query.get("state")!);
        expect((await fetch(callback)).status).toBe(200);
      },
      tokenEndpoint,
      withDrive,
    );
    const token = join(directory, tokenName);
    expect(JSON.parse(readFileSync(token, "utf8"))).toEqual({
      refresh_token: refresh,
    });
    if (process.platform === "win32") {
      const account = execFileSync("whoami.exe", { encoding: "utf8" })
        .trim()
        .toLowerCase();
      const acl = execFileSync("icacls.exe", [token], { encoding: "utf8" })
        .trim()
        .toLowerCase();
      expect(acl).toContain(account + ":(f)");
      expect(acl.match(/:\([^\r\n]+?\)/g)).toEqual([":(f)"]);
    } else {
      expect(statSync(token).mode & 0o777).toBe(0o600);
    }
    const revoke = vi.fn<typeof fetch>(async (input, options) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/revoke");
      expect(new URLSearchParams(String(options?.body)).get("token")).toBe(
        refresh,
      );
      return new Response(null, { status: 200 });
    });
    await googleLogout(directory, revoke);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(readdirSync(directory)).toEqual([]);
  },
);
