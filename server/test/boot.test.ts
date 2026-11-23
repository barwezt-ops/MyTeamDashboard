import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

function expectStorageFailure(dataDir: string) {
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
  expect(result.stderr.trim()).toBe(
    "DATA_DIR is not writable. Set DATA_DIR to a writable directory.",
  );
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

it("starts one live sync after listening and skips it on the next boot", async () => {
  const config = loadConfig();
  config.sources.master.sheetId = "FakeMaster";
  config.sources.master.gid = "10";
  config.sources.schedule.sheetId = "FakeSchedule";
  config.sources.schedule.gid = "20";
  expect(config.sources.attendance.enabled).toBe(false);
  vi.stubEnv("DASHBOARD_SOURCE_CONFIG", JSON.stringify(config));
  vi.spyOn(env, "readEnv").mockReturnValue({
    ...fixtureEnv,
    DATA_DIR: directory,
    SOURCE_MODE: "live",
  });
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
  const today = () => new Date("2026-11-21T12:00:00.000Z");

  for (const expected of ["all", null]) {
    const { server, sync } = startServer(today);
    try {
      expect(sync.active).toBeNull();
      expect(request).toHaveBeenCalledTimes(expected ? 0 : 2);
      await once(server, "listening");
      expect(sync.active).toBe(expected);
      expect((server.address() as AddressInfo).port).toBeGreaterThan(0);
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
        { job: "roster", ok: 1 },
        { job: "schedule", ok: 1 },
        { job: "rules", ok: 1 },
      ]);
    } finally {
      db.close();
    }
  }
});
