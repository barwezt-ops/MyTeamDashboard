import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Linter } from "eslint";
import { afterEach, expect, it, vi } from "vitest";
import {
  paths,
  publish,
  startup,
  taskXml,
} from "../../deploy/windows/common.mjs";

const roots: string[] = [];

it.each(["run.js", "startup.js"])(
  "keeps %s compatible with Windows Script Host JScript",
  (file) => {
    const script = readFileSync(
      new URL(`../../deploy/windows/${file}`, import.meta.url),
      "utf8",
    );
    const errors = new Linter().verify(script, [
      { languageOptions: { ecmaVersion: 3, sourceType: "script" } },
    ]);
    expect(errors).toEqual([]);
  },
);
const result = (status: number, output = "", detail = "") => ({
  status,
  output,
  detail,
});

function sandbox() {
  const repo = mkdtempSync(join(tmpdir(), "Dashboard & test-"));
  roots.push(repo);
  const p = paths(repo);
  mkdirSync(p.lock, { recursive: true });
  mkdirSync(p.dist, { recursive: true });
  writeFileSync(join(p.dist, "version"), "old");
  writeFileSync(join(repo, ".env"), "");
  return p;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("registers an interactive, limited logon task with a hidden launcher and restart policy", () => {
  const p = sandbox();
  const execute = vi.fn((_exe, args) => {
    if (args.length === 6 && args[0] === "//B") return result(73);
    if (args[0] === "/Query") return result(0x80070003);
    if (args[0] === "/Create") {
      const xml = readFileSync(args[4], "utf16le");
      expect(xml).toMatch(/^\uFEFF<\?xml version="1\.0" encoding="UTF-16"\?>/);
      expect(xml).toContain(
        "<LogonTrigger><UserId>S-1-5-21-111-222-333-1001</UserId>",
      );
      expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
      expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
      expect(xml).toContain("<Hidden>true</Hidden>");
      expect(xml).toContain("<RestartOnFailure>");
      expect(xml).toContain("Dashboard &amp; test-");
      return result(0);
    }
    return result(4);
  });
  const check = vi.fn(() => '"TEST\\OWNER","S-1-5-21-111-222-333-1001"');
  const auto = startup(p, execute, check);
  auto.probe();
  expect(execute.mock.calls[0][0]).toMatch(/wscript\.exe$/);
  expect(auto.inspect()).toMatchObject({ kind: null, blocked: false });
  expect(auto.register(false)).toEqual({ kind: "task", managed: true });
});

it("falls back on a scheduler permission error and stops if Startup is blocked", () => {
  const p = sandbox();
  const execute = vi.fn((_exe, args) =>
    args[0] === "/Create" ? result(0x80070005) : result(2),
  );
  const auto = startup(p, execute, () => "S-1-5-21-111-222-333-1001");
  expect(() => auto.register(false)).toThrow("Startup folder (create) failed");
  expect(execute.mock.calls.map(([, args]) => args[0])).toEqual([
    "/Create",
    "//B",
  ]);
  execute
    .mockReturnValueOnce(result(0x80070005))
    .mockReturnValueOnce(result(0));
  expect(auto.register(false)).toEqual({ kind: "shortcut", managed: true });
});

it("reports a blocked Windows Script Host without attempting registration", () => {
  const p = sandbox();
  const execute = vi.fn(() => result(0, "", "blocked by policy"));
  const auto = startup(p, execute);
  expect(() => auto.probe()).toThrow("wscript.exe launcher probe failed");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("refuses to manage a scheduled task from another checkout", () => {
  const p = sandbox();
  const other = { ...p, repo: p.repo + "-other" };
  const execute = vi.fn(() =>
    result(0, taskXml(other, "S-1-5-21-111-222-333-1001")),
  );
  expect(() => startup(p, execute).inspect()).toThrow("another checkout");
});

it.each([false, true])(
  "switches staged builds and restores the previous build on failure (%s)",
  async (fails) => {
    const p = sandbox();
    const versions: string[] = [];
    const registered = { kind: "task", managed: true };
    const auto = {
      probe: vi.fn(),
      inspect: () => registered,
    };
    const check = vi.fn();
    const deploy = publish(p, true, {
      auto,
      check,
      readHealth: async () => true,
      stopService: vi.fn(async () => {}),
      build: (_paths, release) => {
        expect(readFileSync(join(p.dist, "version"), "utf8")).toBe("old");
        const build = join(release, "server", "dist");
        mkdirSync(build, { recursive: true });
        writeFileSync(join(build, "version"), "new");
        return {
          build,
          directory: join(tmpdir(), "Dashboard data"),
          port: 3000,
        };
      },
      startService: async () => {
        const version = readFileSync(join(p.dist, "version"), "utf8");
        versions.push(version);
        if (fails && version === "new") throw new Error("unhealthy");
      },
    });
    expect(check).toHaveBeenCalledWith(
      "git",
      ["pull", "--ff-only"],
      p.repo,
      true,
    );
    if (fails) {
      await expect(deploy).rejects.toThrow("unhealthy");
      expect(versions).toEqual(["new", "old"]);
      expect(readFileSync(join(p.dist, "version"), "utf8")).toBe("old");
      expect(readdirSync(p.runtime)).toEqual(["node-deploy.lock"]);
    } else {
      await deploy;
      expect(versions).toEqual(["new"]);
      expect(readFileSync(join(p.dist, "version"), "utf8")).toBe("new");
      expect(readdirSync(p.runtime)).toHaveLength(3);
    }
  },
);
