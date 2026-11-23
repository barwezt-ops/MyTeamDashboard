import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("initializes a fresh database using only compiled build artifacts", () => {
  const directory = mkdtempSync(resolve("server/dist/isolated-db-"));
  try {
    for (const file of ["db.js", "schema.sql"]) {
      copyFileSync(resolve("server/dist/db", file), join(directory, file));
    }
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import { pathToFileURL } from "node:url";
        const { openDb } = await import(pathToFileURL(process.argv[1]));
        const db = openDb(":memory:");
        try {
          process.stdout.write(String(db.prepare("SELECT COUNT(*) AS count FROM agents").get().count));
        } finally {
          db.close();
        }
      `,
        join(directory, "db.js"),
      ],
      { encoding: "utf8" },
    );
    expect(output.trim()).toBe("0");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
