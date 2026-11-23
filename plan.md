# Team Dashboard — Full Build Plan (for the coding agent)

> **This is the original v1 spec (2026-11-20).** It's kept as the reference for *what* to build. Current status, decisions and everything that changed since live in `memory.md` — read that first. Real names and sheet IDs are never in this repo; the sample config uses `Demo Lead` / `Cover Lead`.

> **Read this whole file before writing any code.** Build in the phase order in §13. Each phase ends with acceptance criteria and a review checkpoint. Stop at every checkpoint and hand over the listed items for review before starting the next phase.

| | |
|---|---|
| **Owner** | The repo owner (the team's DTL) |
| **Reviewer** | Claude (reviews code at each checkpoint) |
| **Version** | Plan v2, 2026-11-20 (public-link route) |
| **One-line goal** | A private web dashboard that pulls the company Google Sheets **by their view link** on a schedule, keeps **only my team**, and shows today's floor, discrepancies, attendance trends, agent profiles and roster changes. |

---

## 0. Rules for the coding agent

1. **Never write to the source sheets.** Read-only, by public link only. No Google login, no Apps Script, no Google Cloud project, no API keys.
2. **Never invent business rules.** No attendance thresholds, targets or policies get hard-coded. Anything policy-like goes in config and **ships empty**.
3. **Join on Agent Code, never on name.** Names differ between sheets (details in §5).
4. **Only whitelisted columns get read into memory or saved.** Phone numbers, emails, laptop numbers and "American Name" are dropped at parse time (§11).
5. **No patient data exists in these sources, and none may ever be stored.** If an unexpected column shows up that isn't in the config map, ignore it.
6. **Config over code.** Sheet IDs, tab IDs, column letters, the schedule anchor, cron times and status labels all live in `config/sources.json`.
7. **Fail loudly.** If a source returns HTML instead of CSV, a required column is missing, or there are 0 team rows, log it, mark the sync failed, and show it on the dashboard. **Never wipe existing data on a failed sync.**
8. **TypeScript strict mode, small modules, unit tests for every parser and rule.**
9. **Ask the owner** (don't guess) about anything in §15 "Open questions" when you reach it.

---

## 1. Background: why this design

- The company sheets are huge. Apps Script fails with "too large", and Apps Script isn't an option anyway.
- The sheet links **open in an incognito window** (shared as "anyone with the link can view"). So a server can download them as CSV with **no auth**.
- the owner only has view access. That's enough, because we only read.
- One small Node service does everything: the scheduled sync, the API, and serving the dashboard. It's hosted on Railway (the owner's existing stack) with a persistent volume.

---

## 2. Tech stack (fixed, don't substitute without asking)

| Layer | Choice |
|---|---|
| Runtime | Node 20 LTS, TypeScript (strict) |
| Server | Express 4 |
| Scheduler | `node-cron` (timezone `Africa/Cairo`) running inside the same always-on service |
| CSV | `csv-parse` (sync API) |
| Config validation | `zod` |
| Database | SQLite via `better-sqlite3`, file on a Railway volume (`/data/dashboard.db`) |
| Auth | Single-user password: `bcrypt` hash in an env var, signed httpOnly session cookie, login rate limit |
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS, Recharts for charts, React Router |
| Tests | Vitest (server + parsers + rules), Playwright for one smoke test of the UI |
| Lint/format | ESLint + Prettier |
| Hosting | Railway, one service + one volume. **The repo must be private.** |

---

## 3. Repo layout

```
team-dashboard/
├── README.md                    # setup, env vars, how to add a sheet link, deploy steps
├── plan.md                      # this file
├── package.json                 # root workspace scripts
├── .env.example
├── config/
│   └── sources.json             # ALL sheet + business config (see §6)
├── fixtures/                    # local-only CSV test data (gitignored except *.sample.csv)
│   ├── master.sample.csv
│   ├── schedule.sample.csv
│   └── attendance.sample.csv
├── server/
│   ├── src/
│   │   ├── index.ts             # express app, static web, cron start
│   │   ├── env.ts               # env parsing (zod)
│   │   ├── config.ts            # load + validate sources.json (zod)
│   │   ├── auth.ts              # login/logout/session middleware
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   ├── db.ts            # open, migrate, helpers
│   │   │   └── repo.ts          # typed queries (upserts, reads)
│   │   ├── fetch/
│   │   │   ├── urls.ts          # build export / gviz URLs
│   │   │   ├── fetchCsv.ts      # download + HTML-detection + retry + timeout
│   │   │   └── fixtures.ts      # SOURCE_MODE=fixture reader
│   │   ├── parse/
│   │   │   ├── columns.ts       # letter↔index, whitelist pick
│   │   │   ├── normalize.ts     # codes, names, dates, cleaning (#REF! etc)
│   │   │   ├── status.ts        # cell value → Status
│   │   │   ├── master.ts        # rows → RosterRow[]
│   │   │   ├── schedule.ts      # rows → ScheduleDay[] (anchor logic)
│   │   │   └── attendance.ts    # long + wide layouts → AttendanceDay[]
│   │   ├── sync/
│   │   │   ├── syncRoster.ts    # weekly
│   │   │   ├── syncSchedule.ts  # daily
│   │   │   ├── syncAttendance.ts# daily
│   │   │   ├── runJob.ts        # wraps a job: lock, log, error handling
│   │   │   └── cron.ts          # registers cron jobs from config
│   │   ├── rules/
│   │   │   ├── index.ts         # runs all rules, upserts discrepancies
│   │   │   └── d1..d7.ts        # one file per rule
│   │   ├── api/
│   │   │   ├── routes.ts
│   │   │   └── dto.ts           # response types shared with web
│   │   └── cli.ts               # `npm run sync -- --job=roster|daily|all`, `npm run test-link -- <url>`
│   └── test/                    # vitest specs mirroring src/
└── web/
    ├── index.html
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx              # layout, router, auth gate
        ├── api.ts               # typed fetch client
        ├── theme.ts             # status colors etc (§10)
        ├── components/          # StatusPill, StatCard, DataTable, AgentDrawer, SyncBadge, EmptyState...
        └── views/
            ├── Login.tsx
            ├── Today.tsx
            ├── Discrepancies.tsx
            ├── Trends.tsx
            ├── Roster.tsx
            ├── Agent.tsx        # profile (drawer or page)
            └── Settings.tsx     # sources status, sync log, manual sync
```

---

## 4. How the app reads a sheet by link

### 4.1 From link to IDs
A link looks like `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=<GID>`.
- `SHEET_ID` = the part between `/d/` and `/edit`
- `GID` = the number after `gid=` (each tab has its own GID)

`npm run test-link -- "<full link>"` must print the `SHEET_ID`, the `GID`, the HTTP status, the content-type and the first 5 parsed rows. the owner uses it to check every new link.

### 4.2 Two fetch modes (per source, set in config)
| Mode | URL | Use for | Caveat |
|---|---|---|---|
| `export` (**default**) | `https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid={GID}` | Everything. Returns the **whole tab** as **display values** (exactly what you see, e.g. `18:00`, `OFF`, `#REF!`). | Downloads the whole tab. That's fine in Node, even for several MB. |
| `gviz` (fallback) | `https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:csv&sheet={TAB}&headers={N}&tq={QUERY}` | Only if `export` is blocked or too slow on the master. Lets Google filter first, e.g. `select B,C,D,G,H where G = 'Demo Lead' or G = 'Cover Lead'`. | Google guesses one data type per column, and **cells of the minority type come back empty**. **Never use gviz for the schedule** (times and "OFF" mixed in one column). Check that codes don't go missing. |

### 4.3 `fetchCsv` requirements
- Follow redirects, 30 s timeout, 2 retries with backoff.
- **HTML detection:** if `content-type` contains `text/html` or the body starts with `<!DOCTYPE` / `<html`, throw `SourceAccessError("link no longer public or moved")`. This is how we find out the owner locked the sheet.
- Strip a UTF-8 BOM, parse with `csv-parse` (`relax_column_count: true`, `skip_empty_lines: false`), and return `string[][]`.
- Log the byte size and row count.
- `SOURCE_MODE=fixture` → read `fixtures/<source>.csv` instead. Same output shape.

---

## 5. Source sheets: known structure

### 5.1 Master / roster (source key `master`)
Header row (when present):

`A Hiring Date | B Code | C Name | D Account | E Account 2 | F Client Name | G Deputy Team Leader | H Team Leader | I Senior TL | J Operations Manager | K Title | L American Name | M Last working day | N Phone number | O Work Email | P Client Email | Q Laptop Number`

Facts the parser must handle:
- Some copies of this data have **no header row**, so `headerRows` is configurable (0 or 1).
- `#REF!` appears in several columns. Treat it as empty.
- **Duplicate codes** exist across tabs/blocks. Dedupe by code, keeping the first occurrence, and log how many duplicates were dropped.
- Codes sometimes come through as `1254.0`. Normalize to `"1254"` (trim, strip a trailing `.0`, keep as a string).
- DTL/TL names as they appear: `Demo Lead`, `Cover Lead`, plus other DTLs not on my team. Match case-insensitively after trim + collapsing spaces.
- **Team membership rule:** a row is on my team if `dtl` OR `tl` matches `me.rosterName` or any of `me.alsoCover`. Store `ownerGroup = "mine"` or `"covered"`.
- Whitelisted columns only: A, B, C, D, E, G, H, I, K, M. **Never N, O, P, Q, L.**

### 5.2 Schedule (source key `schedule`, tab `SHIFTS AND SCHEDULES`)
- Col **A = Code**, **B = Name**, C = TL (**unreliable**: it shows one long TL name for everyone, so ignore it), **D = Account**, E = empty/unused, **F onward = one column per day**.
- The **row-1 day names are broken after column AA** (formula junk), so dates must be found **by anchor**, not by reading headers:
  - `anchor.column = "F"`, `anchor.date = "2026-10-21"` (a Wednesday)
  - date of column *i* = anchor.date + (i − index(F)) days
- **Stop at the first header that matches `stopAtHeader`** (`/removed|counter|casuals/i`). In the current file that's column CN ("OFF to be removed from Annual"). So the day columns are **F…CM = 86 days (2026-10-21 → 2027-01-14)**. Everything after it (counters, "Days OFF" summary) is ignored.
- **Sanity check:** for columns F…AA, compare the header weekday name with the computed date's weekday. If more than 2 disagree, log the warning `ANCHOR_MISMATCH` and show it in Settings. (This catches a new schedule version with a different start date.)
- Read with display values (the export already gives them): shift times look like `15:45`, `18:00`.
- Only keep rows whose code is in the roster team set (from §5.1). Rows with an empty code get skipped.

### 5.3 Attendance (source key `attendance`): NOT mapped yet
the owner still has to provide the link (§15 Q1). Build the parser for **both** layouts, chosen by `layout` in config, and ship it `enabled: false`.

**Layout `long`** — one row per agent per date. Configurable columns: `code`, `name` (optional), `date`, `status`, `missing` (optional free text such as a missing punch or missing hours).

**Layout `wide`** (like the "RD Attendance" workbook) — A = Department, B = DTL, C = Name, then one column per date (header = date).
- `keyType: "name"`: no code here, so match the name to the roster with a normalized full-name compare (lowercase, collapse spaces, strip punctuation). Unmatched names get logged and listed in Settings, never guessed.
- Header dates may carry the **wrong year**. Match on month + day within the sync window.
- **Red font = off day can't be seen in CSV** (formatting is lost). Use the schedule for off days.

Date parsing must accept `M/D/YYYY`, `YYYY-MM-DD`, `D-Mon` and `Mon-D`. Put this behind one tested function.

---

## 6. Config file: `config/sources.json`

Validate with zod at startup. **The app refuses to start on invalid config** and prints a clear error.

```jsonc
{
  "me": { "rosterName": "Demo Lead", "alsoCover": ["Cover Lead"], "defaultScope": "covered" },
  "timezone": "Africa/Cairo",
  "jobs": {
    "daily":  "0 13 * * *",     // schedule + attendance + rules (Cairo time)
    "weekly": "0 12 * * 0"      // master/roster, Sunday 12:00
  },
  "syncWindow": { "pastDays": 35, "futureDays": 14 },
  "sources": {
    "master": {
      "label": "House master sheet", "sheetId": "", "gid": "", "tab": "TEAM",
      "mode": "export", "headerRows": 1,
      "columns": { "hireDate":"A","code":"B","name":"C","account":"D","account2":"E",
                   "dtl":"G","tl":"H","stl":"I","title":"K","lastWorkingDay":"M" }
    },
    "schedule": {
      "label": "Shifts and schedules", "sheetId": "", "gid": "", "tab": "SHIFTS AND SCHEDULES",
      "mode": "export", "headerRows": 1,
      "columns": { "code":"A","name":"B","account":"D" },
      "anchor": { "column": "F", "date": "2026-10-21" },
      "stopAtHeader": "removed|counter|casuals"
    },
    "attendance": {
      "label": "Attendance / discrepancies", "enabled": false,
      "sheetId": "", "gid": "", "tab": "", "mode": "export", "headerRows": 1,
      "layout": "long",
      "long": { "columns": { "code":"A","name":"B","date":"E","status":"F","missing":"G" } },
      "wide": { "keyColumn":"C", "keyType":"name", "firstDateColumn":"D", "dateHeaderRow":1 }
    }
  },
  "statusMap": {
    "off":"Off Day","annual":"PTO","pto":"PTO","upl":"UPL","sick":"Sick","casual":"Casual",
    "on hold":"On Hold","not hired":"Not Hired","present":"Present","absent":"Absent","no show":"Absent"
  },
  "thresholds": {}            // MUST ship empty. Example shape: { "Casual": { "count": 2, "days": 30 } }
}
```

---

## 7. Domain model

### 7.1 Status (one canonical enum)
| Cell value (case-insensitive) | Status | Group | Counts in headcount |
|---|---|---|---|
| matches `^\d{1,2}:\d{2}` (e.g. `15:45`) | `Scheduled` (shiftStart = that time) | working | yes |
| `OFF` | `Off Day` | planned off | no |
| `Annual` / `PTO` | `PTO` | planned leave | no |
| `UPL` | `UPL` | unpaid leave | no |
| `Sick` | `Sick` | unplanned | no |
| `Casual` | `Casual` (**unplanned / emergency leave**) | unplanned | no |
| `Present` | `Present` (attendance only) | working | yes |
| `Absent` / `No show` | `Absent` (attendance only) | unplanned | no |
| `On Hold` | `On Hold` | excluded | **excluded** |
| `Not Hired` | `Not Hired` | excluded | **excluded** |
| empty, `#REF!`, `#N/A`, `#VALUE!`, anything else | `Unknown` (keep raw value) | data issue | flagged by D6 |

Mapping comes from `statusMap` + the time regex. Unknown values are **never** treated as working.

### 7.2 Core types (shared in `api/dto.ts`)
```ts
type Code = string;                       // normalized, e.g. "1866"
type Status = 'Scheduled'|'Off Day'|'PTO'|'UPL'|'Sick'|'Casual'|'Present'|'Absent'|'On Hold'|'Not Hired'|'Unknown';

interface Agent { code: Code; firstName: string; fullName: string; account: string; account2: string;
  dtl: string; tl: string; stl: string; title: string; hireDate: string|null; lastWorkingDay: string|null;
  ownerGroup: 'mine'|'covered'; active: boolean; }

interface ScheduleDay { code: Code; date: string /*YYYY-MM-DD*/; raw: string; status: Status; shiftStart: string|null; }
interface AttendanceDay { code: Code; date: string; raw: string; status: Status; missing: string|null; }

interface Discrepancy { id: string /* `${code}|${date}|${ruleId}` */; code: Code; date: string; ruleId: RuleId;
  severity: 'action'|'info'; missing: string; source: 'schedule'|'attendance'|'roster';
  state: 'open'|'ack'|'resolved'; tlComment: string; createdAt: string; updatedAt: string; }

interface Note { id: number; code: Code; date: string; whatHappened: string; whatWasSaid: string;
  nextStep: string; followUpDate: string|null; done: boolean; createdAt: string; }
```

`firstName` = first token of the full name. The UI shows **first name + code** by default, and the full name only on the profile.

---

## 8. Database (SQLite): `server/src/db/schema.sql`

```sql
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
```

Write rules:
- Sync does **upserts inside one transaction per job**. A job that throws rolls back, so old data stays.
- Sync **never overwrites** `discrepancies.state`, `discrepancies.tl_comment` or anything in `notes`.
- If a discrepancy stops being true on a later sync (e.g. the schedule got fixed): set `auto_cleared = 1`, `state = 'resolved'` **only if the state was `open`**. Keep the row and keep the comment.
- Schedule/attendance rows for team codes are replaced only inside the sync window. Older history is kept, so trends work beyond what the sheet still shows.

---

## 9. Sync jobs

All jobs run through `runJob(name, fn)`, which:
- holds an in-process lock (no overlapping runs),
- writes a `sync_log` row (start, end, ok, counts, warnings, error),
- catches errors, so it never crashes the server.

| Job | Trigger | Steps |
|---|---|---|
| `roster` | weekly cron + `POST /api/sync?job=roster` + automatically before `daily` if the last successful roster sync is more than 7 days old | fetch master → parse whitelisted columns → dedupe → filter team → diff against the `agents` table → write `roster_events` (`new` = code not seen before; `left` = was on the team, now missing or has a lastWorkingDay; `moved` = DTL/TL changed; `rejoined`) → upsert `agents` → write this week's snapshot |
| `schedule` | daily cron | fetch schedule → anchor-map columns → keep team codes → statuses → upsert `schedule_days` within the window → anchor sanity check |
| `attendance` | daily cron, right after `schedule` (skipped if `enabled: false`) | fetch → parse by layout → keep team → upsert `attendance_days` |
| `rules` | at the end of `daily`, and after `roster` | run D1–D7 over the window → upsert discrepancies → auto-clear the ones that went away |

`npm run sync -- --job=all` runs roster → schedule → attendance → rules once (also for local dev).

**Guards:**
- 0 team rows after filtering → fail the job with `NO_TEAM_ROWS`. Usually the name changed in the sheet or the wrong tab got linked.
- A required column is empty for more than 50% of rows → warning `COLUMN_LOOKS_WRONG:<field>`.
- More than 30% of the team disappears from the master in one sync → **don't** mark them left. Fail with `ROSTER_DROP_SUSPICIOUS`.

---

## 10. Discrepancy rules

Every rule is a pure function `(ctx) => Discrepancy[]`, unit-tested with a fixture. `ctx` contains agents, schedule days, attendance days, and today (Cairo). Each rule runs over `[today − pastDays, today]` unless stated otherwise.

| ID | Severity | Condition | `missing` text | Needs attendance? |
|---|---|---|---|---|
| **D1** No record | action | Schedule status = `Scheduled`, **attendance has data for that date** (at least one row for any team member), but this agent has no row, or `raw` is empty | `No attendance record` | yes |
| **D2** Schedule not updated | action | Attendance status ∈ {Sick, Casual, UPL, PTO, Absent}, but the schedule says `Scheduled` | `Schedule shows {shift}, attendance shows {status}` | yes |
| **D3** Leave vs present | action | Schedule status ∈ {Sick, Casual, UPL, PTO}, but attendance = `Present` | `Schedule shows {status}, attendance shows Present` | yes |
| **D4** Missing (WFM) | action | Attendance `missing` is not empty | the `missing` text as-is | yes |
| **D5** Roster/schedule mismatch | action | An active team agent has **no row at all** on the schedule, OR a schedule code belongs to someone **not on the team** (only flag this if their DTL/TL is me or a covered TL in the master; otherwise ignore) | `Not on schedule` / `On schedule but not on team roster` (date = today) | no |
| **D6** Bad schedule cell | action | Schedule status = `Unknown` for an active agent, on a date in the window up to today + 7 | `Schedule cell empty/invalid ("{raw}")` | no |
| **D7** Confirm return | info | Yesterday's schedule/attendance status ∈ {Sick, Casual, UPL, PTO, Absent} **and** today = `Scheduled` | `Confirm return (was {status} yesterday)` | no |

- Agents with status `On Hold` / `Not Hired` on a date are skipped by every rule on that date.
- **Threshold flags** (e.g. "2+ Casual in 30 days") are computed only if `thresholds` has entries. They show as a badge in Trends, never as a discrepancy, and stay off by default.
- The rules apply the same logic to every agent. **No per-agent exceptions in code.**

---

## 11. API (all under `/api`, all require a session except `/api/login`)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/login` | `{ password }` | 204 + cookie; 401; rate-limited to 5/min/IP |
| POST | `/logout` | – | 204 |
| GET | `/me` | – | `{ rosterName, alsoCover, defaultScope }` |
| GET | `/today` | `?scope=mine\|covered\|all&date=YYYY-MM-DD` (date optional, default today Cairo) | `{ date, counts:{scheduled,present,off,leave,unplanned,excluded,unknown}, agents:[{agent, schedule, attendance}], coverage:[{shiftStart, count}], openActions: Discrepancy[], confirmReturn: Discrepancy[], followUpsDue: Note[] }` |
| GET | `/discrepancies` | `?scope&state=open\|ack\|resolved\|all&rule&from&to&code` | `Discrepancy[]` joined with agent first name, TL, account |
| PATCH | `/discrepancies/:id` | `{ state?, tlComment? }` | updated row |
| GET | `/discrepancies/export` | same filters | `{ html, tsv }` table in the **standard layout** (§12.2) |
| GET | `/trends` | `?scope&from&to` | per agent: counts by status (Sick, Casual, UPL, PTO, Absent, Off Day) + discrepancy count; team totals by status; daily series for the chart; threshold badges if configured |
| GET | `/agents` | `?scope` | `Agent[]` |
| GET | `/agents/:code` | – | `{ agent, next7: ScheduleDay[], history: (ScheduleDay & {attendance?})[], discrepancies, notes, fixedOffDays: string[] }` (fixedOffDays = weekdays with `Off Day` in ≥ 75% of the last 4 weeks) |
| POST | `/agents/:code/notes` | `Note` fields | created note |
| PATCH | `/notes/:id` | partial | updated note |
| GET | `/roster/events` | `?since` | `roster_events[]` + agent names |
| GET | `/sync/status` | – | last run per job, ok/failed, warnings, `lastSuccessAt`, source health |
| POST | `/sync` | `?job=roster\|daily\|all` | starts a job, returns 202. Duplicate runs blocked by the lock |

**Scope logic:** `mine` = `ownerGroup = 'mine'`, `covered` = mine + covered, `all` = everything stored (which is only the team anyway).

---

## 12. Dashboard UI

### 12.1 Look and feel
- Clean, modern, data-dense but calm. Left sidebar nav + top bar (scope toggle, date picker, sync badge). Light theme default with a dark mode toggle.
- Font: Inter (or the system UI font). 8-px spacing grid. Cards with a subtle border, 12-px radius, no heavy shadows.
- **Status colors (one source of truth in `theme.ts`, used everywhere):**

| Status | Color |
|---|---|
| Scheduled / Present | green |
| Off Day | neutral grey |
| PTO | blue |
| UPL | purple |
| Sick | amber |
| Casual | orange |
| Absent | red |
| On Hold / Not Hired | slate (muted, struck-through in lists) |
| Unknown | pink-red with a ⚠ icon |

- Every status shows as a **pill with a text label**. Color is never the only signal.
- Responsive down to a laptop at 1280 px. Mobile only needs to be readable, not perfect.
- Empty states and loading skeletons on every view. Errors show the message from the API.
- **Sync badge** in the top bar: "Synced 13:02 today" (green), "Last sync failed — see Settings" (red), "Roster 9 days old" (amber).

### 12.2 Views

**Login** — password field only.

**Today** (default route)
- Stat cards: Scheduled · Present (if attendance is on) · Off · Planned leave · Unplanned (Sick + Casual + Absent) · Excluded · Unknown
- "Needs action" panel: today's open `action` discrepancies + D7 confirm-returns + note follow-ups due today or overdue
- Coverage strip: a horizontal bar per shift start time with the count (e.g. 14:00 ▇▇▇ 3, 15:45 ▇▇▇▇▇ 5)
- Agent table: first name · code · account · shift/status pill · attendance pill · discrepancy icon. Sortable and searchable. A row click opens the Agent drawer.
- Date picker to look at any day in the window.

**Discrepancies**
- Filters: date range, rule, state, agent search, scope
- Table in the **standard layout**: **Code | Name | Team Leader | Account | Date | Missing | TL Comment** + a State column
- Inline editing of TL Comment (saves on blur) and a state dropdown (open → ack → resolved)
- Bulk select → mark resolved
- **"Copy as email table"** button: copies the selected or filtered rows as an HTML table in this exact style, ready to paste into Outlook/Gmail:
  - columns Code | Name | Team Leader | Account | Date | Missing | TL Comment
  - header: dark-blue background, white bold text
  - black 1-px borders on all cells, Arial 11pt
  - uses the clipboard API with both `text/html` and a plain `text/plain` tab-separated fallback

**Trends**
- Range presets: last 7 / 30 / 90 days, month to date
- Stacked bar chart per day by status (unplanned statuses highlighted)
- Per-agent table: first name · Sick · Casual · UPL · PTO · Absent · Discrepancies · threshold badge (only if configured). Sortable.
- A small note under the table: "Counts only. Thresholds come from TL/SOP."

**Roster**
- Sections: New this week · Left / moved · Mismatches (D5)
- Full team list with hire date, tenure (months), account, DTL/TL, and an owner group tag (mine / covered)

**Agent** (drawer from any table, plus a route `/agent/:code`)
- Header: first name, full name (smaller), code, account, DTL/TL, hire date, tenure
- Next 7 days strip (pills), fixed off days
- History calendar: the last 35 days as a grid of colored pills (schedule vs attendance stacked)
- Discrepancies for this agent
- **Notes log** in the documentation format, with fields: Date | What happened | What was said | Agreed next step | Follow-up date | Done ✓. Add, edit and mark done.

**Settings**
- Source cards: label, the sheet link (built from the ID), last fetch result, row counts, warnings (ANCHOR_MISMATCH, unmatched names, etc.)
- Sync log table (last 50 runs)
- "Sync now" buttons: Roster / Daily / All
- Read-only view of the parsed config (thresholds shown as "none set")

---

## 13. Build phases (do them in order)

Rough effort is for a coding agent with the owner reviewing. **Stop at each ✋ checkpoint.**

### Phase 0: Skeleton (≈1–2 h)
- [ ] Repo, workspace scripts, TS strict, ESLint/Prettier, Vitest
- [ ] `env.ts`, `config.ts` with the zod schema from §6. The app refuses to boot on bad config.
- [ ] DB init + migration from `schema.sql`
- [ ] Express app serving `/api/health` and the built web app
- [ ] `.env.example`: `PORT`, `DATA_DIR`, `DASHBOARD_PASSWORD_HASH`, `SESSION_SECRET`, `SOURCE_MODE` (`live|fixture`), `TZ=Africa/Cairo`
- [ ] Script `npm run hash-password` that prints a bcrypt hash

**Done when:** `npm run dev` boots, `/api/health` returns ok, and invalid config prints a readable error.
✋ **Checkpoint 0:** send the repo tree, `config.ts`, `schema.sql`, `.env.example`.

### Phase 1: Fetch + parse + roster (≈3–4 h)
- [ ] `urls.ts`, `fetchCsv.ts` (HTML detection, retries, timeout), fixture mode
- [ ] `npm run test-link -- "<link>"` (§4.1)
- [ ] `columns.ts`, `normalize.ts`, `master.ts` with dedupe, the team filter and the whitelist
- [ ] `syncRoster` + roster events + snapshot
- [ ] Unit tests: code normalization (`"1254.0"`→`"1254"`), `#REF!`→empty, dedupe, team filter case/space handling, whitelist (assert phone/email/laptop never appear in parsed objects), new/left/moved diffs, the `ROSTER_DROP_SUSPICIOUS` guard

**Done when:** in fixture mode, the roster for scope `covered` = the agents under Demo Lead + Cover Lead in the sample master, with no duplicates and none of the forbidden columns. A live `test-link` on the master returns CSV.
✋ **Checkpoint 1:** send the parser + sync code, test output, and a `test-link` run on the real master link with names masked.

### Phase 2: Schedule (≈3–4 h)
- [ ] `status.ts` (§7.1), `schedule.ts` with the anchor logic, `stopAtHeader`, the weekday sanity check
- [ ] `syncSchedule` with window replacement
- [ ] Unit tests: anchor math (F = 2026-10-21, G = 2026-10-22, and so on), the stop column, every status value from §7.1, Unknown handling, the anchor-mismatch warning firing when the anchor is off by one day

**Done when:** for 3 spot-check agents on 3 dates, the stored status = what the sheet cell shows, and the 86-day range is detected in the current schedule.
✋ **Checkpoint 2:** send the code, tests, and a printout of today's statuses for the team (first names only).

### Phase 3: Rules D5–D7 + API core (≈3 h)
- [ ] Rule engine + D5, D6, D7 (these work without attendance)
- [ ] Auto-clear logic, comment preservation
- [ ] `auth.ts` + `/login` `/logout` `/me`
- [ ] `/today`, `/discrepancies` (GET/PATCH), `/agents`, `/agents/:code`, `/sync/status`, `POST /sync`
- [ ] Cron registration from config (`node-cron`, Cairo TZ) + the "roster older than 7 days" auto-run
- [ ] Tests: each rule with a fixture; re-running rules creates no duplicates; a comment survives a re-sync; auto-clear only touches `open` rows

**Done when:** the D5 mismatches in the sample data show up (the sample has team agents missing from the schedule, and a schedule code not on the team list), and the API returns the documented shapes.
✋ **Checkpoint 3:** send the rules, API routes, and test output.

### Phase 4: Dashboard UI (≈6–8 h)
- [ ] Layout, theme, StatusPill, StatCard, DataTable, AgentDrawer, SyncBadge
- [ ] Views: Login, Today, Discrepancies (with Copy as email table), Roster, Agent (with notes), Settings
- [ ] Notes API (`POST /agents/:code/notes`, `PATCH /notes/:id`)
- [ ] Playwright smoke test: log in → Today loads → open an agent → add a note → Discrepancies → copy table

**Done when:** every view works in fixture mode with no console errors. Pasting the copied table into Gmail shows the dark-blue header and black borders.
✋ **Checkpoint 4:** send screenshots of every view (light + dark) and the Playwright result.

### Phase 5: Trends (≈2–3 h)
- [ ] `/trends` + the Trends view (stacked chart, per-agent table, presets)
- [ ] Threshold badges, wired but empty by default

✋ **Checkpoint 5:** screenshots + the trend calculation tests.

### Phase 6: Attendance (blocked until the owner sends the link) (≈3–5 h)
- [ ] Map the real attendance sheet in config (`layout`, columns)
- [ ] `attendance.ts` (long + wide), name matching for wide, the date-format parser
- [ ] `syncAttendance` + rules D1–D4
- [ ] Present count on Today, the attendance pill per agent
- [ ] Tests with a sample built from the real sheet's structure (fake names)

**Done when:** for 5 straight working days, the dashboard's statuses and discrepancies match what the owner finds by hand.
✋ **Checkpoint 6:** send the mapping, parser, rules D1–D4, and a week of comparison notes.

### Phase 7: Deploy (≈1–2 h)
- [ ] Railway: private repo, one service, a volume mounted at `/data`, env vars set, `SOURCE_MODE=live`
- [ ] Health check route, a restart policy, build command `npm run build`, start command `npm start`
- [ ] First live `sync all`, then confirm the cron fired the next day (check the sync log)
- [ ] README: how to add or replace a sheet link (paste the link → `test-link` → update config → redeploy), how to change the anchor, how to rotate the password

✋ **Checkpoint 7 (final):** send the live URL (login screen only), a screenshot of the sync log after 2 cron runs, and the README.

**Total:** ≈ 25–35 h of agent work, depending on the attendance sheet.

---

## 14. Testing requirements

- **Fixtures:** `fixtures/*.sample.csv` use **fake names and fake codes** with the exact same column structure as the real sheets. They're committed. Real CSVs downloaded for local testing go in `fixtures/local/`, which is **gitignored**.
- Sample data must include: duplicate codes, `1254.0`-style codes, `#REF!` cells, a no-header master variant, `On Hold` and `Not Hired` agents, at least one Sick/Casual/UPL/Annual on the schedule, one empty schedule cell, an agent missing from the schedule, a schedule code not on the team, and an agent with a different DTL.
- Coverage target: 90%+ on `parse/` and `rules/`.
- CI (GitHub Actions on the private repo): lint + typecheck + vitest on every push. **No live sheet fetches in CI.**

---

## 15. Open questions (ask the owner at the phase that needs them)

| # | Question | Needed by |
|---|---|---|
| Q1 | Attendance sheet link + tab. What exactly counts as a "discrepancy" in it (missing punch, missing hours, late, no-show)? Long or wide layout? | Phase 6 |
| Q2 | The real house master link + tab name + GID (is the "TEAM" tab a filtered copy of it?) | Phase 1 |
| Q3 | What time (Cairo) does WFM finish updating attendance each day? (sets the daily cron) | Phase 3 |
| Q4 | Does the schedule move to a new file/tab each month? If yes, the anchor + GID change monthly, so add a Settings form to edit them | Phase 2 |
| Q5 | Any SOP thresholds for leave flags? If none, thresholds stay empty | Phase 5 |

---

## 16. Security and privacy checklist (reviewed at every checkpoint)

- [ ] Only whitelisted columns are parsed; a test asserts phone/email/laptop/American Name never reach the DB
- [ ] No patient data fields anywhere in the code, DB or fixtures
- [ ] Private repo; real CSVs gitignored; `.env` gitignored
- [ ] Every route except `/api/login` and `/api/health` requires a session; the cookie is httpOnly, secure, sameSite=lax; login is rate-limited
- [ ] The password is only stored as a bcrypt hash in env
- [ ] No sheet IDs, names or agent data in client-side logs or analytics (no analytics at all)
- [ ] The dashboard is never public. No public preview URLs.
- [ ] Note text is stored as-is, never sent anywhere else
- [ ] **Before anyone other than the owner uses it: the owner flags it to the STL.** (It processes company employee data on a personal Railway account.)
- [ ] **Heads-up for the owner (not the agent):** the source sheets being open to "anyone with the link" is a company data-exposure risk, and also a dependency. If the owner locks them, the sync stops (§4.3 detects this). Worth a quiet mention to the TL.

---

## 17. Review checklist (what Claude checks at each ✋)

1. **Correctness:** joins on code, anchor math, status mapping, rule logic vs §10, timezone (Cairo), date-window edges
2. **Safety of data:** whitelist enforced, failed sync doesn't wipe data, comments/notes never overwritten
3. **Config discipline:** no hard-coded IDs, names, columns or thresholds
4. **Tests:** they exist for every parser and rule, use fake data, and actually assert the edge cases in §14
5. **Fairness:** no per-agent exceptions, no judgement labels, thresholds empty by default
6. **Security:** §16 checklist
7. **UI:** matches §12, status pills always have text, the copy-table output matches the standard layout exactly
8. **Ops:** sync log is useful, errors are readable, the README lets the owner swap a sheet link without the agent

---

## 18. Definition of done (v1)

- [ ] Opens at a private URL behind a password
- [ ] Shows my team (mine / covered toggle) from the live master, refreshed weekly and on demand
- [ ] Today view correct against the live schedule every day, refreshed by cron
- [ ] Discrepancies (D5–D7 now, D1–D4 once attendance is mapped) with comments + Copy as email table
- [ ] Trends, Roster changes, Agent profiles with the notes log
- [ ] Sync failures are visible on the dashboard within one run
- [ ] All tests green in CI, every checkpoint reviewed
