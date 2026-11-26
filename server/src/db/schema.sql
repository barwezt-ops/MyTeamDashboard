CREATE TABLE IF NOT EXISTS agents (
  code TEXT PRIMARY KEY, first_name TEXT, full_name TEXT, account TEXT, account2 TEXT,
  dtl TEXT, tl TEXT, stl TEXT, title TEXT, hire_date TEXT, last_working_day TEXT,
  owner_group TEXT CHECK(owner_group IN ('mine','covered')), active INTEGER DEFAULT 1,
  first_seen TEXT, last_seen TEXT
);
CREATE TABLE IF NOT EXISTS roster_snapshots (
  week_of TEXT, code TEXT, dtl TEXT, tl TEXT, account TEXT, PRIMARY KEY (week_of, code)
);
CREATE TABLE IF NOT EXISTS roster_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, code TEXT,
  type TEXT CHECK(type IN ('new','left','moved','rejoined')), detail TEXT
);
CREATE TABLE IF NOT EXISTS schedule_days (
  code TEXT, date TEXT, raw TEXT, status TEXT, shift_start TEXT, synced_at TEXT, PRIMARY KEY (code, date)
);
CREATE TABLE IF NOT EXISTS attendance_days (
  code TEXT, date TEXT, raw TEXT, status TEXT, missing TEXT, synced_at TEXT, PRIMARY KEY (code, date)
);
CREATE TABLE IF NOT EXISTS discrepancies (
  id TEXT PRIMARY KEY, code TEXT, date TEXT, rule_id TEXT, severity TEXT, missing TEXT, source TEXT,
  state TEXT DEFAULT 'open', tl_comment TEXT DEFAULT '', auto_cleared INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, date TEXT, what_happened TEXT, what_was_said TEXT,
  next_step TEXT, follow_up_date TEXT, done INTEGER DEFAULT 0, created_at TEXT
);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT, started_at TEXT, finished_at TEXT, ok INTEGER,
  rows_read INTEGER, rows_kept INTEGER, warnings TEXT /* JSON array */, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sched_date ON schedule_days(date);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_days(date);
CREATE INDEX IF NOT EXISTS idx_disc_state ON discrepancies(state, date);
CREATE TABLE IF NOT EXISTS schedule_members (code TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS attendance_paste_details (
  code TEXT NOT NULL, date TEXT NOT NULL, fields TEXT NOT NULL, PRIMARY KEY (date, code)
);
CREATE TABLE IF NOT EXISTS attendance_mtd_snapshots (
  sync_date TEXT NOT NULL, code TEXT NOT NULL, cycle_start TEXT NOT NULL, cycle_end TEXT NOT NULL,
  fields TEXT NOT NULL, PRIMARY KEY (sync_date, code)
);
CREATE INDEX IF NOT EXISTS idx_mtd_cycle ON attendance_mtd_snapshots(cycle_start, code, sync_date);
CREATE TABLE IF NOT EXISTS attendance_paste_state (
  id INTEGER PRIMARY KEY CHECK (id=1), fingerprint TEXT NOT NULL, last_changed_at TEXT NOT NULL
);
