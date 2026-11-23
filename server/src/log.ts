import { Console } from "node:console";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";

const maxBytes = 5 * 1024 * 1024;

export function startFileLog(dataDir: string) {
  const directory = join(dataDir, "logs");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "dashboard.log");
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      try {
        const line = Buffer.concat([
          Buffer.from(new Date().toISOString() + " "),
          chunk,
        ]);
        if (existsSync(file) && statSync(file).size + line.length > maxBytes) {
          rmSync(file + ".2", { force: true });
          if (existsSync(file + ".1")) renameSync(file + ".1", file + ".2");
          renameSync(file, file + ".1");
        }
        appendFileSync(file, line.subarray(0, maxBytes));
      } catch {
        process.stderr.write(
          "Could not write dashboard.log. Check DATA_DIR and available disk space.\n",
        );
      }
      done();
    },
  });
  globalThis.console = new Console({ stdout: output, stderr: output });
  process.on("uncaughtExceptionMonitor", (error) => console.error(error));
}
