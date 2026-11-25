import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { paths } from "./common.mjs";

const { pipe, stopFile } = paths();
const control = createServer((socket) => {
  socket.on("error", () => {});
  socket.end();
  if (existsSync(stopFile)) process.emit("SIGTERM");
});
control.once("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
});
control.listen(pipe, async () => {
  const { readEnv } = await import("../../server/dist/env.js");
  const env = readEnv();
  if (env.SOURCE_MODE === "live") {
    const { startFileLog } = await import("../../server/dist/log.js");
    startFileLog(env.DATA_DIR);
  }
  const { startServer } = await import("../../server/dist/index.js");
  startServer(undefined, env);
});
