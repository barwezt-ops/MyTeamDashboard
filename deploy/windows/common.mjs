import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const taskName = "Team Dashboard";
const healthUrl = (port) => `http://127.0.0.1:${port}/api/health`;
const winDir = process.env.SystemRoot || "C:\\Windows";
const wscript = join(winDir, "System32", "wscript.exe");
const schtasks = join(winDir, "System32", "schtasks.exe");
const node = process.execPath;

export function paths(
  repo = realpathSync(fileURLToPath(new URL("../../", import.meta.url))),
) {
  const runtime = join(repo, ".windows-runtime");
  const dist = join(repo, "server", "dist");
  const lock = join(runtime, "node-deploy.lock");
  const id = createHash("sha256").update(repo.toLowerCase()).digest("hex");
  return {
    repo,
    runtime,
    dist,
    lock,
    stopFile: join(lock, "stop"),
    pipe: `\\\\.\\pipe\\team-dashboard-${id}`,
    next: dist + ".next",
    previous: dist + ".previous",
    launcher: join(repo, "deploy", "windows", "run.js"),
    shortcut: join(repo, "deploy", "windows", "startup.js"),
  };
}

function entry(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function winOutput(buffer) {
  const text =
    buffer?.[1] === 0 || (buffer?.[0] === 255 && buffer?.[1] === 254)
      ? buffer.toString("utf16le")
      : buffer?.toString("utf8");
  return (text ?? "").replace(/^\uFEFF/, "").trim();
}

function command(exe, args, cwd, stream = false) {
  const result = spawnSync(exe, args, {
    cwd,
    windowsHide: true,
    stdio: stream ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  const detail = [winOutput(result.stderr), result.error?.message]
    .filter(Boolean)
    .join(" ");
  return {
    status: result.status,
    code: result.error?.code,
    output: winOutput(result.stdout),
    detail,
  };
}

function failed(label, result) {
  return new Error(
    `${label} failed (exit ${result.status ?? result.code ?? "unknown"}).${result.detail ? " " + result.detail : ""}`,
  );
}

function checked(exe, args, cwd, stream = false) {
  const result = command(exe, args, cwd, stream);
  if (result.status !== 0) throw failed(basename(exe), result);
  return result.output;
}

const xml = (value) =>
  value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );

function launcherArgs(p) {
  return ["//B", "//NoLogo", "//E:JScript", p.launcher, node, p.repo, "run"];
}

export function taskXml(p, sid) {
  const args = launcherArgs(p)
    .map((arg) => `"${arg}"`)
    .join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><UserId>${sid}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Owner">
    <UserId>${sid}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>
  </Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <Hidden>true</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Owner"><Exec>
    <Command>${xml(wscript)}</Command><Arguments>${xml(args)}</Arguments>
    <WorkingDirectory>${xml(p.repo)}</WorkingDirectory>
  </Exec></Actions>
</Task>`;
}

function schedulerUnavailable(result) {
  return (
    ["EACCES", "EPERM", "ENOENT"].includes(result.code) ||
    [
      0x80070005, 0x800702e4, 0x800704ec, 0x80041315, 0x80041322, 0x80070422,
    ].includes(result.status >>> 0) ||
    /access is denied|requires elevation|group policy|task scheduler service is not (?:available|running)/i.test(
      result.detail,
    )
  );
}

export function startup(p, execute = command, check = checked, launch = spawn) {
  function task(action, ...options) {
    return execute(
      schtasks,
      [action, "/TN", taskName, ...options, "/HRESULT"],
      p.repo,
    );
  }

  function shortcut(action) {
    const args = launcherArgs(p)
      .map((arg) => `"${arg}"`)
      .join(" ");
    const result = execute(
      wscript,
      ["//B", "//NoLogo", "//E:JScript", p.shortcut, action, p.repo, args],
      p.repo,
    );
    if (result.status === 3)
      throw new Error("The Startup shortcut belongs to another checkout.");
    if (result.status === 4 && action === "inspect") return false;
    if (result.status !== 0) {
      throw failed(
        result.status === 2 || result.status === 5
          ? `Startup folder (${action})${result.status === 5 ? ": access denied" : ""}`
          : `wscript.exe for Startup (${action})`,
        result,
      );
    }
    return true;
  }

  return {
    probe() {
      const result = execute(wscript, launcherArgs(p).slice(0, -1), p.repo);
      if (result.status !== 73)
        throw failed("wscript.exe launcher probe", result);
    },
    inspect() {
      const result = task("/Query", "/XML");
      if (result.status === 0) {
        const directory =
          /<WorkingDirectory>([^<]+)<\/WorkingDirectory>/i.exec(
            result.output,
          )?.[1] ?? "";
        if (
          directory
            .toLowerCase()
            .replaceAll("&apos;", "'")
            .replaceAll("&quot;", '"') !==
          xml(p.repo)
            .toLowerCase()
            .replaceAll("&apos;", "'")
            .replaceAll("&quot;", '"')
        ) {
          throw new Error("The scheduled task belongs to another checkout.");
        }
        return { kind: "task", managed: result.output.includes("run.js") };
      }
      const blocked = schedulerUnavailable(result);
      if (
        !blocked &&
        ![0x80070002, 0x80070003].includes(result.status >>> 0) &&
        !/cannot find the (?:path|file) specified/i.test(result.detail)
      ) {
        throw failed("schtasks.exe /Query", result);
      }
      if (blocked) console.warn(failed("schtasks.exe /Query", result).message);
      return { kind: shortcut("inspect") ? "shortcut" : null, blocked };
    },
    register(blocked) {
      if (!blocked) {
        const sid = /S-1-(?:\d+-)*\d+/.exec(
          check("whoami.exe", ["/user", "/fo", "csv", "/nh"], p.repo),
        )?.[0];
        if (!sid)
          throw new Error("Could not determine the current Windows user SID.");
        const file = join(p.lock, "task.xml");
        writeFileSync(file, taskXml(p, sid));
        try {
          const result = task("/Create", "/XML", file);
          if (result.status === 0) return { kind: "task", managed: true };
          if (!schedulerUnavailable(result))
            throw failed("schtasks.exe /Create", result);
          console.warn(failed("schtasks.exe /Create", result).message);
        } finally {
          unlinkSync(file);
        }
      }
      shortcut("create");
      console.log(
        "Task Scheduler is unavailable. The Startup shortcut starts at sign-in and has no automatic restart.",
      );
      return { kind: "shortcut", managed: true };
    },
    start({ kind }) {
      if (kind === "task") {
        const result = task("/Run");
        if (result.status !== 0) throw failed("schtasks.exe /Run", result);
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const child = launch(wscript, launcherArgs(p), {
          cwd: p.repo,
          windowsHide: true,
          detached: true,
          stdio: "ignore",
        });
        child.once("error", (error) =>
          reject(new Error(`wscript.exe could not start: ${error.message}`)),
        );
        child.once("exit", (code) =>
          reject(
            new Error(
              `wscript.exe dashboard launcher exited (code ${code}). Check the dashboard log.`,
            ),
          ),
        );
        child.unref();
        // The caller races this against the health check.
      });
    },
    endLegacy() {
      const result = task("/End");
      if (result.status !== 0) throw failed("schtasks.exe /End", result);
    },
    taskState() {
      const result = task("/Query", "/FO", "CSV", "/NH");
      if (result.status !== 0) throw failed("schtasks.exe /Query", result);
      return /,"([^"]+)"$/.exec(result.output)?.[1] ?? "registered";
    },
    remove({ kind }) {
      if (kind === "shortcut") shortcut("remove");
      if (kind === "task") {
        const result = task("/Delete", "/F");
        if (result.status !== 0) throw failed("schtasks.exe /Delete", result);
      }
    },
  };
}

async function health(port) {
  try {
    const response = await fetch(healthUrl(port), {
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    });
    const result = response.ok ? await response.json() : null;
    if (result?.ok === true && result.version) return result;
  } catch {
    return null;
  }
  return null;
}

export function launcherProbeTimeout(env = process.env) {
  const value = env.DASHBOARD_LAUNCHER_PROBE_TIMEOUT_MS ?? "2500";
  const timeout = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 100 ||
    timeout > 30_000
  )
    throw new Error(
      "DASHBOARD_LAUNCHER_PROBE_TIMEOUT_MS must be an integer from 100 to 30000.",
    );
  return timeout;
}

function ping(p) {
  const timeout = launcherProbeTimeout();
  return new Promise((resolve) => {
    const socket = createConnection(p.pipe);
    socket.setTimeout(timeout, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
    socket.once("end", () => resolve(true));
    socket.resume();
  });
}

async function waitFor(test, description) {
  const deadline = Date.now() + 30_000;
  do {
    if (await test()) return;
    await delay(500);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out waiting for ${description}. Run status.cmd for the dashboard log.`,
  );
}

async function stop(p, registration, auto, port) {
  if (await ping(p)) {
    writeFileSync(p.stopFile, "");
    try {
      await waitFor(
        async () => !(await ping(p)) && !(await health(port)),
        "dashboard shutdown",
      );
    } finally {
      unlinkSync(p.stopFile);
    }
  } else if (await health(port)) {
    if (registration.kind !== "task" || registration.managed)
      throw new Error(
        `A dashboard already responds on port ${port}, and this installer cannot identify its launcher.`,
      );
    auto.endLegacy();
    await waitFor(async () => !(await health(port)), "dashboard shutdown");
  }
}

async function start(registration, auto, port, p) {
  const launched = auto.start(registration);
  const ready = waitFor(
    async () =>
      (!registration.managed || (await ping(p))) && (await health(port)),
    `dashboard health on port ${port}`,
  );
  if (registration.kind === "shortcut") await Promise.race([launched, ready]);
  else {
    await launched;
    await ready;
  }
}

function readSettings(p, build, validate) {
  // The subprocess resolves .env, DATA_DIR and the private config from the live checkout.
  const script = `import { pathToFileURL } from "node:url";
const { readDataDir, readEnv } = await import(pathToFileURL(process.argv[1]));
if (process.argv[2]) {
  const env = readEnv();
  const { loadConfig } = await import(pathToFileURL(process.argv[2]));
  loadConfig(undefined, env.SOURCE_MODE);
}
console.log(JSON.stringify({directory:readDataDir(),port:Number(process.env.PORT || 3000)}));`;
  const args = ["--input-type=module", "-e", script, join(build, "env.js")];
  if (validate) args.push(join(build, "config.js"));
  return JSON.parse(checked(node, args, p.repo));
}

function buildRelease(p, release) {
  const archive = join(release, "source.tar");
  checked("git", ["archive", "--output", archive, "HEAD"], p.repo);
  checked("tar.exe", ["-xf", archive, "-C", release], p.repo);
  unlinkSync(archive);
  const npm = process.env.ComSpec || join(winDir, "System32", "cmd.exe");
  checked(npm, ["/d", "/s", "/c", "npm.cmd ci"], release, true);
  checked(
    node,
    [
      "-e",
      "const fromServer=require('node:module').createRequire(require('node:path').resolve('server/package.json')); fromServer('better-sqlite3')(':memory:').close()",
    ],
    release,
  );
  checked(npm, ["/d", "/s", "/c", "npm.cmd run build"], release, true);
  const build = join(release, "server", "dist");
  copyFileSync(
    join(release, "deploy", "windows", "run.js"),
    join(build, "windows-task.js"),
  );
  const { directory, port } = readSettings(p, build, true);
  mkdirSync(directory, { recursive: true });
  return { build, directory, port };
}

function removeRelease(p, release) {
  if (
    dirname(release) === p.runtime &&
    /^release-[0-9a-f]{32}$/.test(basename(release))
  ) {
    rmSync(release, { recursive: true, force: true });
  }
}

const releaseId = () => randomUUID().replaceAll("-", "");

export async function publish(
  p,
  update,
  {
    auto = startup(p),
    build = buildRelease,
    readHealth = health,
    stopService = stop,
    startService = start,
    isManagedRunning = ping,
    check = checked,
  } = {},
) {
  auto.probe();
  const current = auto.inspect();
  if (update && !current.kind)
    throw new Error(
      "Dashboard startup entry is missing. Run install.cmd first.",
    );
  if (entry(p.previous) || entry(p.next))
    throw new Error(
      "A previous deployment left dist.previous or dist.next. Review those paths before retrying.",
    );
  if (!existsSync(join(p.repo, ".env")))
    throw new Error("Copy .env.example to .env and fill it in first.");
  if (update) check("git", ["pull", "--ff-only"], p.repo, true);
  const release = join(p.runtime, "release-" + releaseId());
  mkdirSync(release);
  let wasRunning = false;
  let stopped = false;
  let saved = false;
  let switched = false;
  let registered = false;
  let startAttempted = false;
  let active = current;
  let recover = false;
  let committed = false;
  let port;
  try {
    const staged = build(p, release);
    const { build: built, directory } = staged;
    port = staged.port;
    symlinkSync(built, p.next, "junction");
    const responds = Boolean(await readHealth(port));
    if (!current.kind && responds)
      throw new Error(`A dashboard is already running on port ${port}.`);
    wasRunning = responds || (current.managed && (await isManagedRunning(p)));
    await stopService(p, current, auto, port);
    stopped = true;
    if (entry(p.dist)) {
      renameSync(p.dist, p.previous);
      saved = true;
    }
    renameSync(p.next, p.dist);
    switched = true;
    if (!current.kind) {
      active = auto.register(current.blocked);
      registered = true;
    }
    startAttempted = true;
    await startService(active, auto, port, p);
    committed = true;
    console.log(`Team Dashboard is running. Data folder: ${directory}`);
  } catch (error) {
    try {
      if (startAttempted) await stopService(p, active, auto, port);
      if (registered) auto.remove(active);
      if (switched) unlinkSync(p.dist);
      if (saved) renameSync(p.previous, p.dist);
      if (stopped && wasRunning) await startService(current, auto, port, p);
    } catch (restore) {
      recover = true;
      throw new Error(
        `Deployment failed: ${error.message}\nRollback failed: ${restore.message}`,
      );
    }
    throw new Error(
      `Deployment failed: ${error.message}\nThe previous build is in place if one existed.`,
    );
  } finally {
    if (!recover) {
      try {
        if (entry(p.next)) unlinkSync(p.next);
        if (!committed) {
          removeRelease(p, release);
        } else if (saved && entry(p.previous).isSymbolicLink()) {
          const oldRelease = dirname(
            dirname(resolve(dirname(p.previous), readlinkSync(p.previous))),
          );
          unlinkSync(p.previous);
          removeRelease(p, oldRelease);
        } else if (saved) {
          renameSync(
            p.previous,
            join(p.runtime, "previous-build-" + releaseId()),
          );
        }
      } catch (error) {
        console.warn(`Could not clean up a build folder: ${error.message}`);
      }
    }
  }
}

async function status(p, auto) {
  const { kind } = auto.inspect();
  const settings = entry(p.dist) ? readSettings(p, p.dist) : null;
  const port = settings?.port ?? 3000;
  const ready = await health(port);
  const entryLabel =
    kind === "task"
      ? `scheduled task (${auto.taskState()})`
      : kind === "shortcut"
        ? "Startup shortcut"
        : "not installed";
  console.log(`Startup: ${entryLabel}`);
  console.log(
    `Health: ${ready ? JSON.stringify(ready) : "unavailable at " + healthUrl(port)}`,
  );
  if (!settings) return;
  const { directory } = settings;
  console.log(`Data folder: ${directory}`);
  const log = join(directory, "logs", "dashboard.log");
  if (existsSync(log)) {
    console.log("Last 20 log lines:");
    console.log(
      readFileSync(log, "utf8").trimEnd().split(/\r?\n/).slice(-20).join("\n"),
    );
  } else console.log("No dashboard log yet.");
}

export async function run(action) {
  try {
    if (
      process.platform !== "win32" ||
      process.arch !== "x64" ||
      !process.versions.node.startsWith("20.")
    )
      throw new Error("Run these scripts on Windows with Node.js 20 x64.");
    const p = paths();
    const auto = startup(p);
    if (action === "status") return await status(p, auto);
    mkdirSync(p.runtime, { recursive: true });
    if (entry(p.runtime).isSymbolicLink())
      throw new Error(
        "The Windows release folder must be inside the checkout.",
      );
    try {
      mkdirSync(p.lock);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      throw new Error(
        "A Windows deployment is already running or was interrupted. Review .windows-runtime/node-deploy.lock.",
      );
    }
    try {
      if (action === "uninstall") {
        const registration = auto.inspect();
        const settings = entry(p.dist) ? readSettings(p, p.dist) : null;
        if (registration.kind) {
          await stop(p, registration, auto, settings?.port ?? 3000);
          auto.remove(registration);
        }
        console.log(
          `Startup entry removed. Existing data remains${settings ? " at " + settings.directory : " in its data folder"}.`,
        );
      } else await publish(p, action === "update", { auto });
    } finally {
      rmdirSync(p.lock);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
