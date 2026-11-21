import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type Db = Database.Database;
export function openDb(directory: string): Db {
  if (directory !== ":memory:")
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new Database(
    directory === ":memory:" ? directory : resolve(directory, "dashboard.db"),
  );
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const version = db.pragma("user_version", { simple: true });
    if (version === 0)
      db.transaction(() => {
        db.exec(
          readFileSync(
            new URL("../../src/db/schema.sql", import.meta.url),
            "utf8",
          ),
        );
        db.pragma("user_version = 1");
      })();
    else if (version !== 1)
      throw new Error("Unsupported database schema version");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
