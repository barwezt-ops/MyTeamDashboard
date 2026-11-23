# Team Dashboard

A password-protected dashboard for team schedules, roster changes, attendance and discrepancies. The Node service reads the configured Google Sheets through public CSV links. SQLite stores team history and notes.

## Local development

Use Node 20. Install dependencies and create an environment file.

```sh
npm ci
cp .env.example .env
npm run hash-password
node -p "require('node:crypto').randomBytes(48).toString('base64url')"
```

Paste the bcrypt output into `DASHBOARD_PASSWORD_HASH` in `.env`. Set `SESSION_SECRET` to the generated random string.

```sh
npm run sync -- --job=all
npm run dev
```

Use the local Vite address printed by `npm run dev`. It proxies `/api` to port 3000. If you change the server port, update the Vite proxy to match. Fixture mode uses the checked-in synthetic CSVs by default. The sample schedule starts on October 21, 2026. For testing at another time of year, use the Playwright fixture clock or supply matching local fixture data and configure its anchor.

Environment keys live in `.env.example`. The optional `DASHBOARD_SOURCE_CONFIG` setting holds the full live config JSON as a service environment variable. Real config and SQLite data belong in private local files or the hosting service.

## Connect or replace a sheet

1. Open the intended tab and copy its view link. Check the export with `npm run test-link -- '<link>'`. It reports the HTTP status, content type, row count, mapped headers, mismatches and one interpreted sample date. Add `--source=master`, `--source=schedule` or `--source=attendance` to use the configured mapping for a new link. The schedule sample uses its configured anchor. Settings → **Check a link** shows the same diagnostics without changing configuration. Select a column mapping and optionally enter the numeric tab GID, or paste a tab-specific view link.
2. Copy `config/sources.json` to the gitignored `config/sources.local.json` for a local live run. For Railway, set `DASHBOARD_SOURCE_CONFIG` to the full JSON. Set the configured identity, IDs, GIDs and mappings. Set `dateOrder` to `DMY` for slash dates in day/month/year order. The default is `MDY`. Sheet access must be read-only and work without signing in.
3. Keep schedule on CSV export. Set `sources.schedule.anchor.column` and `sources.schedule.anchor.date` to the first date column and its Cairo date, and retain a matching `stopAtHeader`. Check the latest sync for `ANCHOR_MISMATCH`.
4. Confirm attendance column meanings and verify its CSV export before enabling it. A nonempty value from the long layout’s configured `missing` column creates a D4 finding. The parser also supports a wide layout with date columns and no separate Missing field.
5. Restart or redeploy and run **Sync now → All** in Settings. Check that the job results remain healthy and spot-check the dates against the sheet.

The roster sync runs Sundays at 12:00 Cairo. The daily schedule, attendance and discrepancy sync runs at 16:00 Cairo. The app refreshes the roster first when its last successful sync is more than seven days old.

## Railway

### 1. Create the project and attach storage

After the Phase 7 PR is merged, choose **New Project → GitHub Repo** in Railway and select `barwezt-ops/MyTeamDashboard`. Choose **Add Variables** to stage the service before its first deploy. Use the `main` branch and keep the repository root as the service root. Use one service with one replica. Leave **Serverless** off so the scheduled jobs can run even when nobody is signed in.

Right-click the project canvas, choose **Attach Volume**, select the dashboard service, and set the mount path to `/data`. This volume holds the SQLite database and nightly backups. Keep it attached when redeploying or rolling back. [Railway quick start](https://docs.railway.com/quick-start) · [Volumes](https://docs.railway.com/volumes)

### 2. Set the service variables

Open the dashboard service's **Variables** tab and add the entries below. Run `npm ci` from the repository folder before generating the password hash or checking sheet links. The app targets Node 20. On Windows, Node 24 can run these setup commands if the Node 20 install asks for Visual Studio C++ build tools.

| Variable                  | Purpose and how to set it                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`                | Set to `/data` so SQLite and backups use the mounted volume.                                                                                                                              |
| `SOURCE_MODE`             | Set to `live` so the service reads the configured Google Sheets and uses secure session cookies.                                                                                          |
| `TZ`                      | Set to `Africa/Cairo` for the server's timezone. The example JSON also uses Cairo for the sync jobs.                                                                                      |
| `DASHBOARD_PASSWORD_HASH` | Run `npm run hash-password` locally, type your chosen dashboard password, and press Enter. Paste only the resulting bcrypt hash into the variable. Save the password privately for login. |
| `SESSION_SECRET`          | Run `node -p "require('node:crypto').randomBytes(48).toString('base64url')"` locally and paste the generated string into the variable. It signs dashboard sessions.                       |
| `DASHBOARD_SOURCE_CONFIG` | Paste the full JSON prepared in the next step into this single variable. It contains the team filter, sources, and schedule settings.                                                     |
| `PORT`                    | Railway provides this listening port automatically. Leave it unset in the service variables.                                                                                              |

Keep real source links, team names, and secrets in private local files or service variables. [Railway variables](https://docs.railway.com/variables)

### 3. Prepare the live config with attendance off

Copy the **EXAMPLE** JSON below to `config/sources.local.json` on your machine. The file is gitignored. Replace the demo lead names with the exact roster names used in the lead columns. Use `[]` for `me.alsoCover` if you cover nobody. For each master and schedule tab, copy the sheet ID from between `/d/` and the next slash in its view link and the numeric GID after `gid=`. Set the tab names and check the column letters against the tabs. For the schedule, set `anchor.column` and `anchor.date` to the first date column and its Cairo date in `YYYY-MM-DD` format.

Run `test-link` on the real master first. Set `dateOrder` from the sample date by comparing the reported `sampleDate` with the date in the sheet. Use `MDY` for month/day/year or `DMY` for day/month/year. If the report is empty or the date is ambiguous, verify an unambiguous date in the master, then rerun the check. Confirm that all ten mapped headers match `expectHeaders`. Check the schedule link too. Keep `sources.attendance.enabled` set to `false`.

```sh
npm run test-link -- '<real master tab view link>' --source=master
npm run test-link -- '<real schedule tab view link>' --source=schedule
```

When both links export CSV without sign-in and the results match the tabs, paste the entire edited JSON into `DASHBOARD_SOURCE_CONFIG` in Railway.

```json
{
  "me": {
    "rosterName": "Demo Lead",
    "alsoCover": ["Cover Lead"],
    "defaultScope": "covered"
  },
  "dateOrder": "MDY",
  "timezone": "Africa/Cairo",
  "jobs": {
    "daily": "0 16 * * *",
    "weekly": "0 12 * * 0"
  },
  "syncWindow": {
    "pastDays": 35,
    "futureDays": 14
  },
  "sources": {
    "master": {
      "label": "House master sheet",
      "sheetId": "EXAMPLE_MASTER_SHEET_ID",
      "gid": "123456789",
      "tab": "TEAM",
      "mode": "export",
      "headerRows": 1,
      "columns": {
        "hireDate": "A",
        "code": "B",
        "name": "C",
        "account": "D",
        "account2": "E",
        "dtl": "G",
        "tl": "H",
        "stl": "I",
        "title": "K",
        "lastWorkingDay": "M"
      },
      "expectHeaders": {
        "hireDate": "Hiring Date",
        "code": "Code",
        "name": "Name",
        "account": "Account",
        "account2": "Account 2",
        "dtl": "Deputy Team Leader",
        "tl": "Team Leader",
        "stl": "Senior TL",
        "title": "Title",
        "lastWorkingDay": "Last working day"
      }
    },
    "schedule": {
      "label": "Shifts and schedules",
      "sheetId": "EXAMPLE_SCHEDULE_SHEET_ID",
      "gid": "987654321",
      "tab": "SHIFTS AND SCHEDULES",
      "mode": "export",
      "headerRows": 1,
      "columns": {
        "code": "A",
        "name": "B",
        "account": "D"
      },
      "anchor": {
        "column": "F",
        "date": "2026-10-21"
      },
      "stopAtHeader": "removed|counter|casuals"
    },
    "attendance": {
      "label": "Attendance / discrepancies",
      "enabled": false,
      "sheetId": "",
      "gid": "",
      "tab": "",
      "mode": "export",
      "headerRows": 1,
      "layout": "long",
      "long": {
        "columns": {
          "code": "A",
          "name": "B",
          "date": "E",
          "status": "F",
          "missing": "G"
        }
      },
      "wide": {
        "keyColumn": "C",
        "dtlColumn": "B",
        "keyType": "name",
        "firstDateColumn": "D",
        "dateHeaderRow": 1
      }
    }
  },
  "statusMap": {
    "off": "Off Day",
    "annual": "PTO",
    "pto": "PTO",
    "upl": "UPL",
    "sick": "Sick",
    "casual": "Casual",
    "on hold": "On Hold",
    "not hired": "Not Hired",
    "present": "Present",
    "absent": "Absent",
    "no show": "Absent"
  },
  "thresholds": {}
}
```

### 4. Deploy, sign in, and check the first sync

1. Review the staged changes and click **Deploy**. The checked-in `railway.json` sets `npm run build`, `npm start`, `/api/health`, and the **On Failure** restart policy. The health check can pass while the first sync is still running.
2. When the deployment is successful, open the service's **Settings → Networking → Public Networking**, click **Generate Domain**, and open the HTTPS URL. Sign in with the password you chose.
3. In dashboard **Settings**, wait for the automatic first sync to finish, then click **Sync now → All** to verify the setup. In **Sync log**, confirm `roster`, `schedule`, and `rules` succeeded. Read **Details** for warnings or errors and check the source cards for more context. For example, correct the master mapping if you see `COLUMN_HEADER_MISMATCH` or check the schedule's first date column and anchor if you see `ANCHOR_MISMATCH`. Run **All** again after applying a correction. Spot-check the Roster and Today views against the source tabs.
4. The next day, after 16:00 Cairo, refresh **Settings → Sync log**. Look for a successful `backup` at 02:00 and successful `schedule` and `rules` entries starting at 16:00 Cairo or shortly after. Use the **Started** column to distinguish the scheduled rows from a manual run. The weekly roster job runs Sunday at 12:00 Cairo. If an expected entry is missing or failed, check the Railway deployment logs and the **Details** column.
5. For Checkpoint 7, share the HTTPS login URL, a screenshot of the sync log showing the two scheduled runs with any sensitive details cropped out, and this runbook.

### 5. Maintain the deployment

- **Swap a sheet link.** Paste the new tab's view link into **Settings → Check a link** or run the appropriate `test-link` command above. Check the headers and sample date. Edit that source's `sheetId`, `gid`, `tab`, and any changed mappings in your local JSON. Replace the whole `DASHBOARD_SOURCE_CONFIG` value, deploy the staged change, then run **Settings → Sync now → All** and review the log.
- **Change the schedule anchor.** When the first date column or its date changes, update `sources.schedule.anchor.column` and `sources.schedule.anchor.date`, and verify `stopAtHeader` still matches the first non-date section. Deploy the updated JSON, run **All**, and check for `ANCHOR_MISMATCH` and correct dates on **Today**.
- **Rotate the password.** Generate a new bcrypt hash with `npm run hash-password`. Replace `DASHBOARD_PASSWORD_HASH`, deploy the staged change, and sign in again with the new password. Changing the hash invalidates existing sessions.
- **Roll back a bad deploy.** In the Railway service's **Deployments** tab, find the last good deployment, open its three-dot menu, choose **Rollback**, and confirm. Railway restores the previous image and service variables, so verify which password and source config are now active. The attached volume retains its current data. Open the HTTPS URL, sign in, and check the dashboard and sync log. [Railway rollback](https://docs.railway.com/deployments/deployment-actions#rollback)

## Verification

```sh
npm run lint
npm run typecheck
npm run coverage
npx playwright install chromium
npm run smoke
npm run build
```

Playwright runs against synthetic data and writes light and dark screenshots under `test-results/`. CI runs lint, typechecks and unit tests without fetching live sheets.

## Back up and restore dashboard data

Settings → **Download backup** saves a JSON file with notes, roster history, and discrepancy states and TL comments. The server also writes a nightly backup at 02:00 Africa/Cairo under `DATA_DIR/backups` (on Railway, `/data/backups`). It keeps the 14 most recent dated files. Keep downloaded copies private.

In Settings, choose a JSON file under **Restore from backup** and click **Preview restore**. Review the added, updated, and removed counts, then click **Confirm restore**. Restore replaces notes and roster history in a single transaction. It applies saved states and comments to discrepancies from the file and keeps any newer discrepancies outside the backup. After a new database is seeded, an archived discrepancy can retain its state and comment even if the source text is unavailable. Schedule and attendance remain intact.

On the machine that has the database, run `npm run backup` to save a copy. Run `npm run restore -- /path/to/backup.json` to restore immediately using the same `DATA_DIR` as the running app.

## How to map the attendance sheet

1. Identify the layout and header rows. In a long sheet, each row contains an agent code, date and status. Set `sources.attendance.layout` to `long` and map `long.columns.code`, `date`, `status`, and, if available, `name` and `missing`. Check `dateOrder` against an unambiguous slash date.
2. In a wide sheet, each row is one agent and date headers run across columns. Set `layout` to `wide` and configure `wide.keyColumn`, `keyType`, `firstDateColumn`, `dateHeaderRow`, and `dtlColumn`. Prefer code where present. With names, the parser matches a unique normalized full name. Date headers use the month and day inside the sync window because the printed year may be wrong. CSV cannot carry off-day formatting, so off days use the schedule.
3. In your local live config, fill `sheetId`, `gid`, and `headerRows`. Keep `enabled: false`. Use Settings → **Check a link** with the attendance mapping to check the CSV. Sync roster and schedule before the dry run.
4. Select **Dry-run attendance** in Settings, or run `npm run sync -- --job=attendance --dry-run` with the existing dashboard's `DATA_DIR`. Review source rows, team matches, records and dates that would be stored, sample statuses, and projected D1–D4 counts. Long sheets identify rows by code and cannot distinguish an unrecognized team code from a non-team code. A wide sheet can count unmatched rows under a configured team lead.
5. Enable attendance only after the mappings and sample results agree with the source. Validate the dashboard against the sheet for five working days as part of Phase 6 acceptance.
