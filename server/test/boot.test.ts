import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import * as env from "../src/env.js";
import { startServer } from "../src/index.js";

const fixtureEnv = {
  PORT: 0,
  DATA_DIR: ":memory:",
  SOURCE_MODE: "fixture",
  TZ: "Africa/Cairo",
  DASHBOARD_PASSWORD_HASH: "$2b$04$" + "x".repeat(53),
  SESSION_SECRET: "synthetic-boot-test-session-secret",
} satisfies env.Env;

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "dashboard-boot-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function expectStorageFailure(
  dataDir: string,
  message = "DATA_DIR is not writable. Set DATA_DIR to a writable directory.",
) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "server/src/index.ts"],
    {
      env: { ...process.env, ...fixtureEnv, PORT: "3000", DATA_DIR: dataDir },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe(message);
}

it("exits cleanly when DATA_DIR points to a file", () => {
  const file = join(directory, "not-a-directory");
  writeFileSync(file, "");
  expectStorageFailure(file);
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "exits cleanly when DATA_DIR is a directory without write permission",
  () => {
    const db = openDb(directory);
    db.close();
    chmodSync(directory, 0o500);
    try {
      expectStorageFailure(directory);
    } finally {
      chmodSync(directory, 0o700);
    }
  },
);

it("refuses to start with DATA_DIR in OneDrive", () => {
  expectStorageFailure(
    join(directory, "OneDrive - Example", "data"),
    "Move DATA_DIR out of OneDrive — syncing a live database can corrupt it.",
  );
});

it("uses the Windows default and rejects repo and OneDrive environment paths", () => {
  vi.stubEnv("LOCALAPPDATA", directory);
  vi.stubEnv("DATA_DIR", "");
  expect(env.readDataDir(true)).toBe(
    join(realpathSync.native(directory), "TeamDashboard", "data"),
  );
  vi.stubEnv("DATA_DIR", "./data");
  expect(() => env.readDataDir(true)).toThrow(
    "outside the Team Dashboard repository",
  );
  const customRoot = join(directory, "synced");
  vi.stubEnv("OneDriveCommercial", customRoot);
  vi.stubEnv("DATA_DIR", join(customRoot, "database"));
  expect(() => env.readDataDir(true)).toThrow("Move DATA_DIR out of OneDrive");
  mkdirSync(customRoot);
  const link = join(directory, "data-link");
  symlinkSync(
    customRoot,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  vi.stubEnv("DATA_DIR", join(link, "not-created-yet"));
  expect(() => env.readDataDir(true)).toThrow("Move DATA_DIR out of OneDrive");
});

it("catches up once after listening and honors the local bind address", async () => {
  const config = loadConfig();
  config.sources.master.sheetId = "FakeMaster";
  config.sources.master.gid = "10";
  config.sources.schedule.sheetId = "FakeSchedule";
  config.sources.schedule.gid = "20";
  expect(config.sources.attendance.enabled).toBe(false);
  vi.stubEnv("DASHBOARD_SOURCE_CONFIG", JSON.stringify(config));
  const liveEnv = {
    ...fixtureEnv,
    PORT: 3000,
    DATA_DIR: directory,
    SOURCE_MODE: "live" as const,
  };
  for (const [key, value] of Object.entries(liveEnv))
    vi.stubEnv(key, String(value));
  const readEnv = env.readEnv;
  vi.spyOn(env, "readEnv").mockImplementation(() => ({
    ...readEnv(),
    PORT: 0,
  }));
  const request = vi.fn(async (input: string) => {
    const sheet = new URL(input).searchParams.get("gid");
    const source =
      sheet === "10" ? "master" : sheet === "20" ? "schedule" : null;
    return source
      ? new Response(
          readFileSync("fixtures/" + source + ".sample.csv", "utf8"),
          {
            headers: { "content-type": "text/csv" },
          },
        )
      : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", request);
  const today = () => new Date("2026-11-21T16:00:00.000Z");

  for (const [expected, local, address] of [
    ["daily", true, "127.0.0.1"],
    [null, false, "0.0.0.0"],
  ] as const) {
    vi.stubEnv("BIND_HOST", undefined);
    const { server, sync } = startServer(today, { ...env.readEnv(), local });
    try {
      expect(sync.active).toBeNull();
      expect(request).toHaveBeenCalledTimes(expected ? 0 : 2);
      await once(server, "listening");
      expect(sync.active).toBe(expected);
      expect((server.address() as AddressInfo).address).toBe(address);
    } finally {
      await vi.waitFor(() => expect(sync.active).toBeNull());
      const closed = once(server, "close");
      server.close();
      await closed;
    }
    expect(request).toHaveBeenCalledTimes(2);
    const db = openDb(directory);
    try {
      expect(
        db.prepare("SELECT job, ok FROM sync_log ORDER BY id").all(),
      ).toEqual([
        { job: "backup", ok: 1 },
        { job: "daily", ok: 1 },
        { job: "roster", ok: 1 },
        { job: "schedule", ok: 1 },
        { job: "rules", ok: 1 },
      ]);
    } finally {
      db.close();
    }
  }
});
