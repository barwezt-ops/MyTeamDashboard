import express, { type ErrorRequestHandler } from "express";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { loadConfig, type Config } from "./config.js";
import { bindHost, readEnv, type Env } from "./env.js";
import { openDb, type Db } from "./db/db.js";
import { agentsOf, lastDashboardSyncAt } from "./db/repo.js";
import { auth } from "./auth.js";
import { endpoint } from "./api/request.js";
import { checkLinkRoutes } from "./api/checkLink.js";
import { createRoutes } from "./api/routes.js";
import { createSync, type SyncService } from "./sync/service.js";
import { backupRoutes } from "./backup/routes.js";
import { startBackupCron, startCron, startLiveJobs } from "./sync/cron.js";
import { startFileLog } from "./log.js";
import { csvLimit, uploadAttendanceCsv } from "./fetch/sourceFile.js";
import { SourceAccessError } from "./fetch/fetchCsv.js";

const { version } = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));

export function createApp(env: Env, config: Config, db: Db, sync: SyncService) {
  const login = auth(env);
  const app = express();
  app.disable("x-powered-by");
  if (env.SOURCE_MODE === "live")
    app.set("trust proxy", bindHost(env) === "127.0.0.1" ? "loopback" : 1);
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(
    "/api",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        req.get("Sec-Fetch-Site") === "cross-site"
      ) {
        res.status(403).json({ error: "Cross-site request rejected" });
        return;
      }
      next();
    },
    express.json({ limit: "128kb" }),
    login.session,
  );
  app.get(
    "/api/health",
    endpoint({}, (_input, _req, res) => {
      res.json({ ok: true, version, lastSyncAt: lastDashboardSyncAt(db) });
    }),
  );
  app.post("/api/login", login.loginLimit, login.login);
  app.use("/api", login.requireSession);
  app.post("/api/logout", login.logout);
  app.use("/api/backup", backupRoutes(db));
  app.use("/api/check-link", checkLinkRoutes(config, env.DATA_DIR));
  app.post("/api/attendance/upload", async (req, res, next) => {
    if (
      env.SOURCE_MODE !== "live" ||
      config.sources.attendance.access !== "file"
    ) {
      res.status(409).json({
        error:
          "Set attendance access to file in the live source configuration.",
      });
      return;
    }
    if (
      !req.is("application/octet-stream") ||
      ![undefined, "identity"].includes(req.get("Content-Encoding"))
    ) {
      res.status(415).json({ error: "Choose an uncompressed attendance CSV." });
      return;
    }
    if (Number(req.get("Content-Length")) > csvLimit) {
      res.status(413).json({ error: "The attendance CSV exceeds 150 MB." });
      return;
    }
    try {
      await uploadAttendanceCsv(
        req.iterator({ destroyOnReturn: false }),
        config,
        env.DATA_DIR,
        agentsOf(db),
      );
      res.sendStatus(204);
    } catch (error) {
      req.resume();
      if (error instanceof SourceAccessError)
        res.status(error.status ?? 422).json({ error: error.message });
      else next(error);
    }
  });
  app.use("/api", createRoutes(db, config, sync, env.SOURCE_MODE === "live"));
  app.use(express.static(webDist, { index: false }));
  app.get("*", (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!["/", "/login"].includes(req.path)) {
      return login.session(req, res, () => {
        if (!login.signedIn(req)) {
          res.redirect("/login");
          return;
        }
        res.sendFile(join(webDist, "index.html"));
      });
    }
    res.sendFile(join(webDist, "index.html"));
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: error.issues
          .map((issue) => issue.path.join(".") + ": " + issue.message)
          .join("; "),
      });
      return;
    }
    if (error?.status >= 400 && error.status < 500) {
      res.status(error.status).json({
        error:
          error.type === "entity.parse.failed"
            ? "body: Invalid JSON"
            : "Invalid request",
      });
      return;
    }
    console.error(
      "Request failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
    res.status(500).json({ error: "Something went wrong" });
  };
  app.use(errors);
  return app;
}

export function startServer(now?: () => Date, env = readEnv()) {
  const config = loadConfig(undefined, env.SOURCE_MODE);
  const db = openDb(env.DATA_DIR);
  const sync = createSync(db, config, env.SOURCE_MODE, now, env.DATA_DIR);
  const app = createApp(env, config, db, sync);
  const live = env.SOURCE_MODE === "live";
  const jobs = live ? startLiveJobs(db, env.DATA_DIR, config, sync, now) : null;
  const cron = live ? [] : startCron(config, sync);
  if (!live && env.DATA_DIR !== ":memory:")
    cron.push(startBackupCron(db, env.DATA_DIR));
  const server = app.listen(env.PORT, bindHost(env), () => {
    console.log("Team Dashboard listening on port " + env.PORT);
    void jobs?.check();
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.once("close", () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    jobs?.stop();
    for (const task of cron) void task.destroy();
    if (!sync.active) db.close();
  });
  return { app, server, sync };
}
if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
)
  try {
    const env = readEnv();
    if (env.local && env.SOURCE_MODE === "live") startFileLog(env.DATA_DIR);
    startServer(undefined, env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
