import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { chromium } from "playwright-core";
import { afterEach, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { fetchBrowserAttendance } from "../src/fetch/browserAttendance.js";
import { sampleMaster } from "./sample.js";

const roots: string[] = [];
const never = () => new Promise<never>(() => {});
type Launch = typeof chromium.launchPersistentContext;
function setup(timeoutMs = 1500) {
  const root = mkdtempSync(join(tmpdir(), "dashboard-browser-test-"));
  roots.push(root);
  const config = loadConfig();
  Object.assign(config.sources.attendance, {
    access: "browser",
    sheetId: "FakeAttendance",
    gid: "42",
    browser: { ...config.sources.attendance.browser, timeoutMs },
  });
  return { root, config, agents: sampleMaster().agents };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function mockDownload(
  csv?: string,
  destination = "about:blank",
  onGoto?: () => void,
) {
  const close = vi.fn(async () => {});
  const goto = vi.fn(async () => {
    onGoto?.();
    return null;
  });
  const launch = vi.fn(
    async (_profile: string, options: Parameters<Launch>[1]) => {
      const path = join(options!.downloadsPath!, "download.csv");
      if (csv) writeFileSync(path, csv);
      return {
        pages: () => [
          {
            url: () => destination,
            title: async () => "",
            goto,
            waitForURL: never,
            waitForEvent: () =>
              csv ? Promise.resolve({ path: async () => path }) : never(),
          },
        ],
        close,
      };
    },
  );
  return { launch: launch as unknown as Launch, close, goto };
}

function expectClean(root: string) {
  expect(readdirSync(root)).toEqual(["browser-profile"]);
  expect(readdirSync(join(root, "browser-profile"))).toEqual([]);
}

const csv =
  "Code,Name,Discard,,Date,Status,Missing\n" +
  "99001,Fixture Agent,discard-team,,2026-11-21,Present,\n" +
  "99999,Other Agent,discard-other,,2026-11-21,Absent,\n";

it("downloads using installed Chrome, keeps mapped team data, and deletes the raw file", async () => {
  const { root, config, agents } = setup();
  const { launch, close, goto } = mockDownload(csv);
  const result = await fetchBrowserAttendance(config, root, agents, launch);
  expect(launch).toHaveBeenCalledWith(
    join(realpathSync.native(root), "browser-profile"),
    expect.objectContaining({
      channel: "chrome",
      headless: true,
      acceptDownloads: true,
    }),
  );
  expect(goto).toHaveBeenCalledWith(
    "https://docs.google.com/spreadsheets/d/FakeAttendance/export?format=csv&gid=42",
    expect.anything(),
  );
  expect(result).toMatchObject({ rowsRead: 3, bytes: Buffer.byteLength(csv) });
  expect(result.rows).toHaveLength(2);
  expect(result.rows[1]).toEqual([
    "99001",
    "Fixture Agent",
    "",
    "",
    "2026-11-21",
    "Present",
    "",
  ]);
  expect(close).toHaveBeenCalledOnce();
  expectClean(root);
});

it("deletes raw CSV even if the header is rejected", async () => {
  const { root, config, agents } = setup();
  const { launch, close } = mockDownload(csv.replace("Discard", "Patient ID"));
  await expect(
    fetchBrowserAttendance(config, root, agents, launch),
  ).rejects.toThrow("Possible patient data");
  expect(close).toHaveBeenCalledOnce();
  expectClean(root);
});

it.each([
  ["https://accounts.google.com/v3/signin/identifier", "SIGN_IN_REQUIRED"],
  ["https://accounts.google.com/v3/signin/rejected", "BROWSER_ACCESS_BLOCKED"],
] as const)(
  "distinguishes the Google browser response at %s",
  async (url, code) => {
    const { root, config, agents } = setup();
    const { launch, close } = mockDownload(undefined, url);
    await expect(
      fetchBrowserAttendance(config, root, agents, launch),
    ).rejects.toThrow(code);
    expect(close).toHaveBeenCalledOnce();
    expectClean(root);
  },
);

it("times out a stalled browser and refuses a concurrent download using its profile", async () => {
  const { root, config, agents } = setup(1000);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { launch, close } = mockDownload(undefined, "about:blank", started);
  const first = fetchBrowserAttendance(config, root, agents, launch);
  const timedOut = expect(first).rejects.toThrow("BROWSER_DOWNLOAD_TIMEOUT");
  await ready;
  await expect(
    fetchBrowserAttendance(config, root, agents, launch),
  ).rejects.toThrow("BROWSER_PROFILE_BUSY");
  await timedOut;
  expect(launch).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expectClean(root);
});
