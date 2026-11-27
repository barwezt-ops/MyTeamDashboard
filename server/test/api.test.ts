import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  performanceStart,
  performanceToday,
  seedPerformanceFixture,
} from "../../fixtures/performance.js";
import { loadConfig } from "../src/config.js";
import { openDb, type Db } from "../src/db/db.js";
import { createApp } from "../src/index.js";
import { createSync } from "../src/sync/service.js";

let db: Db;
let server: Server;
let base: string;
let cookie: string;
const password = "fixture-api-password";
const current = () => new Date(performanceToday + "T12:00:00Z");
const clock = vi.fn(current);

beforeAll(async () => {
  db = openDb(":memory:");
  const config = loadConfig();
  const sync = createSync(db, config, "fixture", clock);
  const app = createApp(
    {
      PORT: 3000,
      DATA_DIR: ":memory:",
      SOURCE_MODE: "fixture",
      TZ: "Africa/Cairo",
      DASHBOARD_PASSWORD_HASH: await bcrypt.hash(password, 4),
      SESSION_SECRET: "fixture-api-test-session-secret-1234",
    },
    config,
    db,
    sync,
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api";
  const login = await fetch(base + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  expect(login.status).toBe(204);
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  db.close();
});

function request(method: string, path: string, body?: unknown) {
  return fetch(base + path, {
    method,
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

it.each([
  ["Windows", true, undefined, "127.0.0.1"],
  ["loopback VM", false, "127.0.0.1", "127.0.0.1"],
  ["public bind", false, "0.0.0.0", "0.0.0.0"],
] as const)(
  "uses the expected session cookies for %s",
  async (_name, localMode, bindHost, address) => {
    const loopback = address === "127.0.0.1";
    const config = loadConfig();
    const app = createApp(
      {
        PORT: 3000,
        DATA_DIR: ":memory:",
        SOURCE_MODE: "live",
        local: localMode,
        BIND_HOST: bindHost,
        TZ: "Africa/Cairo",
        DASHBOARD_PASSWORD_HASH: await bcrypt.hash(password, 4),
        SESSION_SECRET: "fixture-local-auth-session-secret",
      },
      config,
      db,
      createSync(db, config, "fixture"),
    );
    const local = app.listen(0, address);
    await once(local, "listening");
    const port = (local.address() as AddressInfo).port;
    async function login(host: string, protocol?: string) {
      const result = await new Promise<{ status?: number; cookies: string[] }>(
        (resolve, reject) => {
          const req = httpRequest(
            {
              hostname: "127.0.0.1",
              port,
              path: "/api/login",
              method: "POST",
              headers: {
                Host: host,
                "Content-Type": "application/json",
                ...(protocol ? { "X-Forwarded-Proto": protocol } : {}),
              },
            },
            (res) => {
              res.resume();
              resolve({
                status: res.statusCode,
                cookies: res.headers["set-cookie"] ?? [],
              });
            },
          );
          req.on("error", reject);
          req.end(JSON.stringify({ password }));
        },
      );
      expect(result.status).toBe(204);
      return result.cookies;
    }
    try {
      for (const host of ["localhost:" + port, "127.0.0.1:" + port]) {
        const direct = await login(host);
        expect(direct).toHaveLength(loopback ? 2 : 0);
        expect(direct.every((value) => !/; secure/i.test(value))).toBe(true);
      }
      const proxyHost = "pc.tailnet.ts.net";
      const fallback = await login(proxyHost);
      expect(fallback).toHaveLength(loopback ? 2 : 0);
      expect(fallback.every((value) => /; secure/i.test(value))).toBe(true);
      expect(await login(proxyHost, "http")).toEqual([]);
      const secure = await login(proxyHost, "https");
      expect(secure).toHaveLength(2);
      expect(secure.every((value) => /; secure/i.test(value))).toBe(true);
      const cookie = (loopback ? fallback : secure)
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(
        (
          await fetch("http://127.0.0.1:" + port + "/api/me", {
            headers: { Cookie: cookie },
          })
        ).ok,
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve) => local.close(() => resolve()));
    }
  },
);

it("serves only the public health fields and reports the last complete data sync", async () => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const health = async () => {
    const response = await fetch(base + "/health");
    expect(response.status).toBe(200);
    return response.json();
  };
  const finish = db.prepare(
    "INSERT INTO sync_log (job, finished_at, ok) VALUES (?, ?, ?)",
  );
  const stamp = (hour: number) =>
    "2026-11-23T" + String(hour).padStart(2, "0") + ":00:00.000Z";

  try {
    expect(await health()).toEqual({ ok: true, version, lastSyncAt: null });
    finish.run("roster", stamp(1), 1);
    finish.run("rules", stamp(2), 1);
    finish.run("schedule", stamp(3), 1);
    finish.run("rules", stamp(4), 0);
    finish.run("backup", stamp(5), 1);
    expect(await health()).toEqual({ ok: true, version, lastSyncAt: stamp(1) });
    finish.run("schedule", stamp(6), 1);
    finish.run("backup", stamp(7), 1);
    finish.run("rules", stamp(8), 1);
    expect(await health()).toEqual({ ok: true, version, lastSyncAt: stamp(8) });
    expect((await fetch(base + "/agents")).status).toBe(401);
    expect((await fetch(base + "/sync/status")).status).toBe(401);
  } finally {
    db.prepare("DELETE FROM sync_log WHERE finished_at LIKE ?").run(
      "2026-11-23T%",
    );
  }
});

describe("API request validation", () => {
  it.each([
    ["GET", "/health?unexpected=1", undefined, "query"],
    ["POST", "/login", { password: 12 }, "body.password"],
    ["POST", "/logout", { unexpected: 1 }, "body"],
    ["GET", "/me?scope=mine", undefined, "query"],
    ["GET", "/today?date=2026-02-30", undefined, "query.date"],
    ["GET", "/discrepancies?rule=D9", undefined, "query.rule"],
    ["GET", "/discrepancies/export?ids=invalid", undefined, "query.ids.0"],
    [
      "PATCH",
      "/discrepancies/bulk",
      { ids: ["FAKE-1|D5"], state: "closed" },
      "body.state",
    ],
    ["PATCH", "/discrepancies/invalid", {}, "params.id"],
    ["GET", "/agents?scope=mine&scope=all", undefined, "query.scope"],
    ["GET", "/agents/%00", undefined, "params.code"],
    ["POST", "/agents/FAKE-1/notes", { done: "yes" }, "body.done"],
    ["PATCH", "/notes/1.5", { done: true }, "params.id"],
    ["GET", "/roster/events?since=tomorrow", undefined, "query.since"],
    ["GET", "/trends?from=2026-13-01", undefined, "query.from"],
    ["GET", "/sync/status?limit=10", undefined, "query"],
    ["POST", "/sync?job=unknown", undefined, "query.job"],
    ["POST", "/sync/attendance-preview", { enabled: true }, "body"],
    ["POST", "/check-link", { link: "https://example.invalid/" }, "body.link"],
    ["GET", "/backup?file=other", undefined, "query"],
    ["POST", "/backup/preview", {}, "body"],
    ["POST", "/backup/restore?token=bad", {}, "query.token"],
  ])(
    "%s %s returns a field-specific 400",
    async (method, path, body, field) => {
      const response = await request(method, path, body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain(field + ":");
    },
  );

  it("rejects a binary body on a bodyless route", async () => {
    const response = await fetch(base + "/logout", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/octet-stream" },
      body: Buffer.from("fixture"),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "body: Unsupported request format",
    });
  });

  it("rejects malformed JSON", async () => {
    const response = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "body: Invalid JSON" });
  });
});

it("versions sync status by one Cairo date during a UTC-to-Cairo midnight crossing", async () => {
  clock
    .mockReturnValueOnce(new Date("2026-12-31T21:59:59Z"))
    .mockReturnValue(new Date("2026-12-31T22:00:00Z"));
  try {
    const response = await request("GET", "/sync/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      date: "2026-12-31",
      window: { from: "2026-11-26", to: "2027-01-14" },
    });
  } finally {
    clock.mockReset().mockImplementation(current);
  }
});

describe("generated 200-agent, 120-day fixture", () => {
  it("keeps Today, Trends, and Discrepancies below 300 ms", async () => {
    seedPerformanceFixture(db);
    expect(db.prepare("SELECT COUNT(*) FROM schedule_days").pluck().get()).toBe(
      24_000,
    );
    const paths = [
      "/today?date=" + performanceToday,
      "/trends?from=" + performanceStart + "&to=" + performanceToday,
      "/discrepancies?state=all",
    ];
    for (const path of paths) {
      const durations: number[] = [];
      for (let sample = 0; sample < 12; sample++) {
        const start = performance.now();
        const response = await request("GET", path);
        expect(response.status).toBe(200);
        const result = await response.json();
        durations.push(performance.now() - start);
        if (path.startsWith("/today")) expect(result.agents).toHaveLength(200);
        if (path.startsWith("/trends")) expect(result.daily).toHaveLength(120);
        if (path.startsWith("/discrepancies")) expect(result).toHaveLength(400);
      }
      const worst = Math.max(...durations);
      console.info(
        path.split("?")[0] + " worst of 12: " + worst.toFixed(1) + " ms",
      );
      expect(worst).toBeLessThan(300);
    }
  });
});

it("reports actual attendance coverage and MTD import dates for the owner's team", async () => {
  db.prepare(
    "INSERT INTO agents (code, owner_group) VALUES ('99091','mine'), ('99092','covered')",
  ).run();
  db.prepare(
    "INSERT INTO attendance_days (code,date) VALUES ('99091','2026-11-19'), ('99092','2026-11-20')",
  ).run();
  db.prepare(
    "INSERT INTO attendance_mtd_snapshots (code,sync_date,cycle_start,cycle_end,fields) VALUES ('99091','2026-11-20','2026-10-21','2026-11-20','{}')",
  ).run();
  try {
    expect(await (await request("GET", "/sync/status")).json()).toMatchObject({
      attendanceThrough: "2026-11-19",
      mtdSyncedOn: "2026-11-20",
    });
    expect(await (await request("GET", "/me")).json()).toMatchObject({
      firstName: "Alex",
      coachingCycleStartDay: 21,
    });
  } finally {
    for (const table of [
      "attendance_days",
      "attendance_mtd_snapshots",
      "agents",
    ])
      db.prepare(`DELETE FROM ${table} WHERE code IN ('99091','99092')`).run();
  }
});
