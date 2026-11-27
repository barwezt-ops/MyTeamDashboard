import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcrypt";
import { afterAll, beforeAll, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { createApp } from "../src/index.js";
import { createSync } from "../src/sync/service.js";
import { mtdMismatchWarning } from "../src/api/dto.js";
import type { DashboardData } from "../src/v2/data.js";
import { fixtureConfig, seedAgents, seedV2Fixture } from "../../fixtures/v2.js";

const db = openDb(":memory:");
let server: Server;
let base: string;
let cookie: string;

beforeAll(async () => {
  const config = fixtureConfig();
  const sync = createSync(
    db,
    config,
    "fixture",
    () => new Date("2026-11-20T12:00:00Z"),
  );
  const password = "fixture-v2-password";
  const app = createApp(
    {
      PORT: 3000,
      DATA_DIR: ":memory:",
      SOURCE_MODE: "fixture",
      TZ: "Africa/Cairo",
      DASHBOARD_PASSWORD_HASH: await bcrypt.hash(password, 4),
      SESSION_SECRET: "fixture-v2-api-session-secret-12345",
    },
    config,
    db,
    sync,
  );
  seedV2Fixture(db);
  seedAgents(db, [["99003", "Casey Sample"]]);
  db.prepare(
    "UPDATE agents SET owner_group='covered' WHERE code='99003'",
  ).run();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/api";
  const login = await fetch(base + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

const request = (method: string, path: string, body?: unknown) =>
  fetch(base + "/v2" + path, {
    method,
    headers: {
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const data = async () =>
  (await (await request("GET", "/data")).json()) as DashboardData;
const agent = async (code = "99001") =>
  (await data()).agents.find((row) => row.code === code)!;

it("reports empty current-cycle MTD and owner-only cell warnings without reusing stored totals", async () => {
  const prior = db
    .prepare("SELECT diagnostics FROM attendance_paste_state WHERE id=1")
    .pluck()
    .get() as string;
  const warnings = ["99001", "99003"].map((code) => ({
    tab: "Attendance",
    code,
    date: "2026-11-19",
    column: "Logout Time",
    error: "#VALUE!",
    rejected: false,
  }));
  try {
    db.prepare(
      "UPDATE attendance_paste_state SET diagnostics=? WHERE id=1",
    ).run(
      JSON.stringify({
        cycleStart: "2026-10-21",
        cycleEnd: "2026-11-20",
        mtdAvailable: false,
        warnings,
      }),
    );
    const status = await (
      await fetch(base + "/sync/status", { headers: { Cookie: cookie } })
    ).json();
    expect(status.mtdSyncedOn).toBeNull();
    expect(status.mtdMismatch).toEqual([]);
    expect(status.pasteWarnings).toEqual([warnings[0]]);
    expect((await agent()).counts.source).toBe("daily");
  } finally {
    db.prepare(
      "UPDATE attendance_paste_state SET diagnostics=? WHERE id=1",
    ).run(prior);
  }
});
const coaching = {
  code: "99001",
  date: "2026-11-20",
  type: "corrective",
  reasons: ["attendance"],
  evidence: ["99001|2026-11-19", "99001|2026-10-21|late"],
  whatHappened: "Synthetic facts",
  whatWasSaid: "Synthetic conversation",
  nextStep: "Logged in by 15:40",
  followUpDate: "2026-11-20",
  acknowledged: true,
  measure: "lateness",
  target: 0,
};

it("requires a session and covers the owner's team only", async () => {
  expect((await fetch(base + "/v2/data")).status).toBe(401);
  expect((await data()).agents.map((row) => row.code).sort()).toEqual([
    "99001",
    "99002",
    "99005",
  ]);
});

it("logs coaching with checked evidence and tracks its follow-up", async () => {
  for (const [change, status] of [
    [{ code: "99003" }, 404],
    [{ date: "2026-11-21" }, 400],
    [{ evidence: ["99002|2026-11-19"] }, 400],
    [{ followUpDate: "2026-11-19" }, 400],
    [{ followUpDate: null }, 400],
    [{ reasons: [] }, 400],
    [{ nextStep: "  " }, 400],
    [{ extra: true }, 400],
  ] as const)
    expect(
      (await request("POST", "/coachings", { ...coaching, ...change })).status,
      JSON.stringify(change),
    ).toBe(status);
  expect((await request("POST", "/coachings", coaching)).status).toBe(201);
  const row = await agent();
  expect(row.coachingDone).toBe(1);
  expect(row.coaching[0].outcome).toMatchObject({ result: "pending" });
  const followUp = row.followUps[0];
  expect(row.flags.some((f) => f.kind === "followup-" + followUp.id)).toBe(
    true,
  );
  expect(
    (await request("PATCH", `/followups/${followUp.id}`, { state: "kept" }))
      .status,
  ).toBe(204);
  expect((await agent()).flags.map((f) => f.kind)).not.toContain(
    "followup-" + followUp.id,
  );
  expect(
    (await request("PATCH", "/followups/999", { state: "kept" })).status,
  ).toBe(404);
});

it("creates, edits and deletes private tagged notes", async () => {
  const note = { date: "2026-11-20", body: "Private sample", tags: ["sample"] };
  expect(
    (await request("POST", "/notes", { ...note, code: "99003" })).status,
  ).toBe(404);
  expect(
    (await request("POST", "/notes", { ...note, code: "99001", body: "" }))
      .status,
  ).toBe(400);
  const created = await request("POST", "/notes", { ...note, code: "99001" });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: number };
  expect(
    (await request("PATCH", `/notes/${id}`, { ...note, body: "Edited" }))
      .status,
  ).toBe(204);
  expect((await agent()).privateNotes[0]).toMatchObject({
    body: "Edited",
    tags: '["sample"]',
  });
  expect((await request("DELETE", `/notes/${id}`)).status).toBe(204);
  expect((await request("DELETE", `/notes/${id}`)).status).toBe(404);
});

it("merges partial settings and dismisses only the facts it was shown", async () => {
  let response = await request("PATCH", "/settings", {
    staffing: { "Sample inbound": 2 },
  });
  expect(await response.json()).toMatchObject({
    latenessIncidents: 3,
    staffing: { "Sample inbound": 2 },
  });
  response = await request("PATCH", "/settings", { missingMinutes: 30 });
  expect(await response.json()).toMatchObject({
    missingMinutes: 30,
    staffing: { "Sample inbound": 2 },
  });
  for (const bad of [{ missingDays: 2 }, { nonsense: 1 }, { qaBelow: 101 }])
    expect((await request("PATCH", "/settings", bad)).status).toBe(400);

  const flag = (await data()).flags.find((row) => row.kind === "late")!;
  const dismissal = { id: flag.id, token: flag.token, reason: "Discussed" };
  expect(
    (
      await request("POST", "/flags/dismiss", {
        ...dismissal,
        token: "0".repeat(64),
      })
    ).status,
  ).toBe(409);
  expect(
    (await request("POST", "/flags/dismiss", { ...dismissal, reason: " " }))
      .status,
  ).toBe(400);
  expect((await request("POST", "/flags/dismiss", dismissal)).status).toBe(204);
  expect((await data()).flags.map((row) => row.id)).not.toContain(flag.id);
  expect((await agent()).dismissals[0]).toMatchObject({ reason: "Discussed" });
});

it("names the team agents whose MTD and daily rows disagree", async () => {
  const log = db.prepare(
    "INSERT INTO sync_log(job,started_at,finished_at,ok,warnings) VALUES ('attendance',?,?,?,?)",
  );
  const run = (ok: number, warnings: string[]) =>
    log.run(
      "2026-11-20T10:00:00Z",
      "2026-11-20T10:00:00Z",
      ok,
      JSON.stringify(warnings),
    );
  const status = async () =>
    (await (
      await fetch(base + "/sync/status", { headers: { Cookie: cookie } })
    ).json()) as { mtdMismatch: unknown[] };
  // Covered agents are left out of the owner's team view.
  run(1, ["no change", mtdMismatchWarning + "99001,99003"]);
  // A failed read leaves the data, and so the warning, as it was.
  run(0, []);
  expect((await status()).mtdMismatch).toEqual([
    { code: "99001", name: "Avery Sample" },
  ]);
  run(1, []);
  expect((await status()).mtdMismatch).toEqual([]);
});
