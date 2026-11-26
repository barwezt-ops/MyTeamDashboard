import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createReadStream, existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
  chromium,
  type BrowserContext,
  type Download,
  type Page,
} from "playwright-core";
import type { Agent } from "../api/dto.js";
import type { Config } from "../config.js";
import { validateDataPath } from "../env.js";
import { SourceAccessError } from "./fetchCsv.js";
import { readAttendanceCsv } from "./sourceFile.js";
import { exportUrl } from "./urls.js";

const exec = promisify(execFile);
const signIn =
  "SIGN_IN_REQUIRED: run npm run browser-login, sign in with your work account, and close the browser.";
export const browserBlocked = "BROWSER_ACCESS_BLOCKED";
const blocked =
  browserBlocked +
  ": Google blocked the browser download. Review the work account access before retrying.";

async function restrictFolder(path: string, root: string) {
  if (process.platform !== "win32") {
    await chmod(path, 0o700);
    return;
  }
  const { stdout } = await exec("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true,
  });
  const sid = /S-1-(?:\d+-)*\d+/.exec(stdout)?.[0];
  if (!sid) throw new Error("Windows account unavailable");
  await exec(
    "icacls.exe",
    [path, "/inheritance:r", "/grant:r", "*" + sid + ":(OI)(CI)F"],
    { windowsHide: true },
  );
  const scratch = await mkdtemp(join(root, ".browser-acl-"));
  try {
    const acl = join(scratch, "acl");
    await exec("icacls.exe", [path, "/save", acl], { windowsHide: true });
    const sddl =
      (await readFile(acl, "utf16le"))
        .split(/\r?\n/)
        .find((line) => line.startsWith("D:P")) ?? "";
    const entries = sddl.match(/\([^()]+\)/g) ?? [];
    if (entries.length !== 1 || !entries[0].endsWith(";" + sid + ")"))
      throw new Error("Unexpected profile access permissions");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function withBrowserProfile<T>(
  dataDir: string,
  run: (profile: string) => Promise<T>,
) {
  if (dataDir === ":memory:")
    throw new SourceAccessError(
      "Browser attendance requires persistent DATA_DIR.",
    );
  const root = validateDataPath(dataDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = join(root, ".browser-attendance.lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new SourceAccessError(
        "BROWSER_PROFILE_BUSY: close browser-login or wait for the active download.",
      );
    throw error;
  }
  try {
    const profile = join(root, "browser-profile");
    try {
      await mkdir(profile, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
      const entry = await lstat(profile);
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        validateDataPath(profile) !== profile
      )
        throw new Error("Unexpected profile path");
      await restrictFolder(profile, root);
    } catch {
      throw new SourceAccessError(
        "Could not secure the browser profile under DATA_DIR.",
      );
    }
    return await run(profile);
  } finally {
    await rmdir(lock);
  }
}

type BrowserSettings = Config["sources"]["attendance"]["browser"];

function browserExecutable(settings: BrowserSettings) {
  if (settings.executablePath) {
    if (
      !isAbsolute(settings.executablePath) ||
      !existsSync(settings.executablePath)
    )
      throw new SourceAccessError(
        "Configure a valid absolute path to the installed browser.",
      );
    return settings.executablePath;
  }
  const parts =
    settings.channel === "msedge"
      ? ["Microsoft", "Edge", "Application", "msedge.exe"]
      : ["Google", "Chrome", "Application", "chrome.exe"];
  for (const root of [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ]) {
    if (root) {
      const candidate = join(root, ...parts);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new SourceAccessError(
    "The configured browser was not found. Set browser.executablePath.",
  );
}

export async function browserLogin(config: Config, dataDir: string) {
  const { browser, sheetId, gid } = config.sources.attendance;
  await withBrowserProfile(dataDir, async (profile) => {
    const executable = browserExecutable(browser);
    const view = sheetId
      ? "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit#gid=" + gid
      : "https://accounts.google.com/";
    const child = spawn(executable, ["--user-data-dir=" + profile, view], {
      stdio: "ignore",
      windowsHide: false,
    });
    const [code] = await once(child, "exit").catch(() => {
      throw new SourceAccessError(
        "Could not open the installed browser for sign-in.",
      );
    });
    if (code !== 0)
      throw new SourceAccessError("The browser closed with an error.");
  });
}

function checkGooglePage(page: Page, status?: number) {
  const url = new URL(page.url());
  if (
    url.hostname === "accounts.google.com" &&
    /(?:rejected|denied|disabled|challenge\/blocked)/i.test(url.pathname)
  )
    throw new SourceAccessError(blocked);
  if (status === 403 || url.pathname.startsWith("/sorry/"))
    throw new SourceAccessError(blocked);
  if (url.hostname === "accounts.google.com" || status === 401)
    throw new SourceAccessError(signIn);
  if (status && status >= 400)
    throw new SourceAccessError(
      "Browser download returned HTTP " + status + ".",
    );
}

async function getDownload(page: Page, url: string) {
  const download = page.waitForEvent("download", { timeout: 0 });
  const signInRedirect = page
    .waitForURL(
      (target) =>
        target.hostname === "accounts.google.com" ||
        target.pathname.startsWith("/sorry/"),
      { waitUntil: "commit", timeout: 0 },
    )
    .then(() => checkGooglePage(page));
  const navigation = page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 0 })
    .then(
      async (response) => {
        checkGooglePage(page, response?.status());
        const title = await page.title();
        if (
          /access denied|browser (?:may be|is) not secure|automated (?:queries|traffic)/i.test(
            title,
          )
        )
          throw new SourceAccessError(blocked);
      },
      (error) => {
        // Chromium reports an aborted navigation when a response starts a download.
        if (!/net::ERR_ABORTED/i.test(String(error)))
          throw new SourceAccessError(
            "Could not open the Google Sheets download in the browser.",
          );
      },
    );
  return Promise.race([
    download,
    signInRedirect.then(() => new Promise<never>(() => {})),
    navigation.then(() => new Promise<never>(() => {})),
  ]);
}

export async function fetchBrowserAttendance(
  config: Config,
  dataDir: string,
  agents: Agent[],
  launch: typeof chromium.launchPersistentContext = chromium.launchPersistentContext.bind(
    chromium,
  ),
) {
  const { browser, sheetId, gid } = config.sources.attendance;
  if (!sheetId || !gid)
    throw new SourceAccessError(
      "Configure the browser attendance spreadsheet link and GID.",
    );
  return withBrowserProfile(dataDir, async (profile) => {
    // Downloads inherit the owner-only profile ACL and are removed even if parsing fails.
    const directory = await mkdtemp(join(profile, ".attendance-download-"));
    let context: BrowserContext | undefined;
    let input: ReturnType<typeof createReadStream> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    try {
      context = await launch(profile, {
        ...(browser.executablePath
          ? { executablePath: browserExecutable(browser) }
          : { channel: browser.channel }),
        headless: true,
        acceptDownloads: true,
        downloadsPath: directory,
        timeout: browser.timeoutMs,
        chromiumSandbox: true,
      });
      const page = context.pages()[0] ?? (await context.newPage());
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SourceAccessError(
                "BROWSER_DOWNLOAD_TIMEOUT: the attendance CSV exceeded the configured download timeout.",
              ),
            ),
          Math.max(0, browser.timeoutMs - (Date.now() - started)),
        );
      });
      const download: Download = await Promise.race([
        getDownload(page, exportUrl(sheetId, gid)),
        timeout,
      ]);
      const path = await Promise.race([download.path(), timeout]);
      if (
        validateDataPath(path) !== path ||
        !path.startsWith(
          directory + (process.platform === "win32" ? "\\" : "/"),
        )
      )
        throw new SourceAccessError(
          "The browser download was not in the private temporary folder.",
        );
      clearTimeout(timer);
      input = createReadStream(path);
      const result = await readAttendanceCsv(input, config, agents);
      return { ...result, elapsedMs: Date.now() - started };
    } catch (error) {
      if (error instanceof SourceAccessError) throw error;
      if (error instanceof Error && error.name === "TimeoutError")
        throw new SourceAccessError(
          "BROWSER_DOWNLOAD_TIMEOUT: the attendance CSV exceeded the configured download timeout.",
        );
      throw new SourceAccessError(
        "Could not download the attendance CSV through the installed browser.",
      );
    } finally {
      clearTimeout(timer);
      input?.destroy();
      try {
        await context?.close();
      } finally {
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
    }
  });
}
