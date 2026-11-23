import { config } from "dotenv";
import { realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
config({ quiet: true });

// Resolve existing parents too, so a new folder below a junction is checked.
function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    const parent = dirname(path);
    if (parent === path || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw error;
    return join(canonical(parent), path.slice(parent.length));
  }
}

const comparable = (path: string) => path.toLowerCase().replace(/[\\/]+$/, "");
const inside = (path: string, root: string) =>
  comparable(path) === comparable(root) ||
  comparable(path).startsWith(comparable(root) + sep);

export function readDataDir(local = process.platform === "win32") {
  const configured = process.env.DATA_DIR?.trim();
  if (configured === ":memory:") {
    if (local && process.env.SOURCE_MODE === "live")
      throw new Error("Windows mode requires persistent DATA_DIR.");
    return configured;
  }
  const appData = process.env.LOCALAPPDATA;
  if (!configured && local && !appData)
    throw new Error("LOCALAPPDATA is missing. Set DATA_DIR to a local folder.");
  const path = resolve(
    configured ||
      (local && appData ? join(appData, "TeamDashboard", "data") : "./data"),
  );
  const resolved = canonical(path);
  const oneDriveRoots = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
    .map((key) => process.env[key])
    .filter((root): root is string => !!root?.trim());
  if (
    [path, resolved].some((candidate) => /onedrive/i.test(candidate)) ||
    oneDriveRoots.some(
      (root) =>
        inside(path, resolve(root)) ||
        inside(resolved, canonical(resolve(root))),
    )
  )
    throw new Error(
      "Move DATA_DIR out of OneDrive — syncing a live database can corrupt it.",
    );
  if (local && inside(resolved, canonical(process.cwd())))
    throw new Error("Move DATA_DIR outside the Team Dashboard repository.");
  return resolved;
}

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BIND_HOST: z.ipv4().optional(),
  DASHBOARD_PASSWORD_HASH: z
    .string()
    .regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, "Expected a bcrypt hash"),
  SESSION_SECRET: z.string().min(32),
  SOURCE_MODE: z.enum(["fixture", "live"]).default("fixture"),
  TZ: z.string().default("Africa/Cairo"),
});
export type Env = z.infer<typeof schema> & {
  DATA_DIR: string;
  local?: boolean;
};
export function readEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      "Invalid environment\n" +
        result.error.issues
          .map((issue) => issue.path.join(".") + ": " + issue.message)
          .join("\n"),
    );
  const local = process.platform === "win32";
  return { ...result.data, DATA_DIR: readDataDir(local), local };
}
