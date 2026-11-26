# memory.md — Team Dashboard
_Last updated: 2026-11-26 for the restricted attendance workbook and dry-run checkpoint._

> Public repo: no real names, codes, sheet IDs or env values in this file. Refer to config keys (e.g. `sources.master.sheetId`) and roles ("the owner", "the covered TL", "the STL").

## 1. Snapshot
- **2026-11-26 attendance checkpoint:** The Windows dashboard is installed. PR #18 was closed with its branch retained. The replacement attendance source is a small restricted workbook. Its three tabs passed the read-only header and row-count check. The new attendance source is pending dry-run review and activation.
- **Phase status:** plan.md Phases 0–5 done (PR #1). Post-plan workstreams B–F done (PRs #2–#6). **All merged to `main` on 2026-11-23.**
- **Remaining for v1 (plan.md §18):** Phase 6 real attendance mapping (blocked on the attendance link). Windows local deployment support merged in PR #10.
- **Tests on main:** 130 Vitest tests, 4 Playwright specs (dashboard flow, 390 px mobile + keyboard + failed-load recovery, 200-agent performance, schema from build artifacts). Lint, typecheck, build clean.
- **What works now (fixture mode and, once configured, live):** roster sync (weekly), schedule sync (daily), rules D5–D7, all dashboard views, notes, discrepancy comments/states, copy-as-email table, backups + restore, check-a-link, attendance dry run, password login.
- **Windows setup checkpoint:** Node 20 x64 dependencies are installed and the private live config is in place with attendance disabled. Both source exports responded, all ten master headers match, and the dated schedule passed the anchor check. Installation is pending review and merge of the month-name date fix.
- **Next task:** Pull the merged fix, rerun the master link check, then resume **Run on your Windows PC** at the installer. Verify health and run **Settings → Sync now → All**. Check the next daily sync and 02:00 Cairo backup after installation.

## 2. Features
| Feature | Status | Where | Notes |
|---|---|---|---|
| Fetch sheets by public CSV link (`export` mode, `gviz` fallback) | done | `fetch/fetchCsv.ts`, `fetch/urls.ts` | HTML response ⇒ `SourceAccessError` ("link no longer public or moved"); retries on 5xx/429; 30 s timeout |
| Master/roster parse + team filter | done | `parse/master.ts` | dedupe by code, `#REF!`→empty, codes `1254.0`→`1254`, team = DTL or TL ∈ {`me.rosterName`, `me.alsoCover`}; `ownerGroup` mine/covered; optional `expectHeaders` check → `COLUMN_HEADER_MISMATCH`; any column letter allowed; sensitive headers refused |
| Month-name dates | review pending | `parse/normalize.ts` | Shared date parser reads full and abbreviated English months with a year in month-first or day-first order. Roster and link diagnostics use the same parser. |
| Roster events (new / left / moved / rejoined) + weekly snapshots | done | `sync/syncRoster.ts` | `ROSTER_DROP_SUSPICIOUS` if >30% vanish |
| Schedule parse with date anchor | done | `parse/schedule.ts` | `anchor.column` + `anchor.date`; stops at `stopAtHeader`; `ANCHOR_MISMATCH` sanity check on early weekday headers; AM/PM and `18:00:00` normalised to 24 h |
| Status mapping | done | `parse/status.ts` | time ⇒ Scheduled; OFF, Annual→PTO, UPL, Sick, Casual (= unplanned/emergency), Present, Absent, On Hold/Not Hired (excluded), else Unknown |
| Attendance parse (long + wide) | done, **disabled** | `parse/attendance.ts` | wide: match by code or unique normalised name, month+day matched within window (year may be wrong), unmatched warnings only for rows whose DTL column is the owner/covered TL |
| Attendance dry run | done | `sync/attendancePreview.ts`, Settings | read-only; projected D1–D4 counts |
| Restricted attendance paste | Disabled until current-cycle paste and owner approval | `fetch/attendancePaste.ts`, `sync/attendancePaste.ts` | Header-based reads, agent/date replacement, daily MTD snapshots, and hourly checks all day by default in Cairo. |
| Rules D1–D7 | done (D1–D4 run only when attendance enabled) | `rules/` | D5 has stable id `code\|D5`; auto-clear only touches `open` rows |
| Sync windows / replacement | done | `sync/service.ts`, `syncSchedule.ts`, `syncAttendance.ts` | window = today −35 / +14; replace only the dates the source covers (`coveredRange`); one Cairo date per run |
| Cron and catch-up | done | `sync/cron.ts` | daily `0 16 * * *`, weekly `0 12 * * 0` (Sun), backup 02:00 Cairo. Startup and 15-minute checks cover the latest elapsed daily slot and today's backup. A successful daily or All must start at or after the slot to satisfy it. Automated retries wait at least one hour. Daily refreshes roster first if missing or >7 days old. |
| Auth | done | `auth.ts` | single bcrypt password in env, signed cookie session (12 h), login rate limit. Loopback live listeners allow direct localhost HTTP sign-in and use secure cookies for Tailscale hostnames even when Serve omits `X-Forwarded-Proto`. |
| API with zod validation | done | `api/routes.ts`, `api/request.ts` | see §3 |
| Copy as email table | done | `api/export.ts` | Code \| Name \| Team Leader \| Account \| Date \| Missing \| TL Comment; header `#16365c` white bold; black 1 px borders; Arial 11 pt |
| Backups + restore | done | `backup/` | nightly 02:00 Cairo to `DATA_DIR/backups`, keep 14; logged as job `backup` in `sync_log`; restore = preview token → confirm, one transaction, never touches schedule/attendance |
| Check a sheet link (UI + CLI) | done | `fetch/checkLink.ts`, Settings | docs.google.com only, URL rebuilt server-side, manual redirects only to Google export hosts, 32 MB cap, 5/min, sensitive-looking headers hidden |
| Views: Login, Today, Discrepancies, Trends, Roster, Agent, Settings | done | `web/src/views/` | light/dark, 390 px phone layout, keyboard + aria, axe clean |
| First live boot and public health | done | `index.ts`, `db/db.ts`, `sync/cron.ts` | Startup checks `DATA_DIR`, then starts catch-up after listening. With no successful roster, the first check starts All once at any Cairo hour. Public health returns only `ok`, `version`, and `lastSyncAt`. |
| Windows local deployment | **merged, install pending** | `deploy/windows/`, `README.md`, `env.ts` | Task Scheduler starts at sign-in. The app binds to `127.0.0.1` and rotates logs in the local data folder. Updates build separately and check health after switching. |
| Free VM and Railway | optional, needs a card | `deploy/`, `README.md` | Existing deploy runbooks remain available. |
| Real attendance mapping | **not done** | — | Phase 6, blocked on link |

## 3. Architecture as built
- **One Node 20 service** (Express 4) does sync jobs (node-cron), API and serves the built Vite/React app. SQLite via better-sqlite3 at `DATA_DIR/dashboard.db`. `schema.sql` is copied into `server/dist` at build.
- **Data flow:** public CSV export → parse (whitelisted columns only) → filter to team codes → upsert in one transaction per job → rules → API → UI.
- **API (all need a session except login/health):** `POST /login`, `POST /logout`, `GET /health`, `GET /me`, `GET /today?scope&date`, `GET /discrepancies?scope&state&rule&from&to&q&code`, `PATCH /discrepancies/:id`, `PATCH /discrepancies/bulk`, `GET /discrepancies/export`, `GET /trends?scope&from&to`, `GET /agents?scope`, `GET /agents/:code`, `POST /agents/:code/notes`, `PATCH /notes/:id`, `GET /roster/events?scope&since`, `GET /sync/status`, `POST /sync?job=roster|daily|all`, `POST /sync/attendance-preview`, `POST /check-link`, `GET /backup`, `POST /backup/preview`, `POST /backup/restore?token`.
- **Scopes:** `mine` (owner's agents), `covered` (+ covered TL's agents, default), `all`.
- **Tables:** agents, roster_snapshots, roster_events, schedule_days, attendance_days, discrepancies, notes, sync_log.

## 4. Config & environment
- Sample config: `config/sources.json` (fake names, empty IDs). Live config: gitignored `config/sources.local.json`, the private path in `DASHBOARD_CONFIG_FILE`, or full JSON in `DASHBOARD_SOURCE_CONFIG` for optional hosts.
- Keys that matter for go-live: `me.rosterName`, `me.alsoCover`, `dateOrder` (`MDY`/`DMY`), `sources.*.sheetId` / `gid`, `sources.master.expectHeaders` (**set it** — it's what catches inserted columns), `sources.schedule.anchor`, `sources.attendance.enabled` (keep false until Phase 6), `thresholds` (empty).
- Env var names: `PORT`, `BIND_HOST`, `DATA_DIR`, `DASHBOARD_PASSWORD_HASH`, `SESSION_SECRET`, `SOURCE_MODE` (`fixture`|`live`), `TZ`, `DASHBOARD_SOURCE_CONFIG`, `DASHBOARD_CONFIG_FILE`.
- Windows run: follow the README to prepare `.env` and live config, check sheet links, run `deploy/windows/install.ps1`, and use **Settings → Sync now → All**. An empty `DATA_DIR` uses `%LOCALAPPDATA%\TeamDashboard\data`. Keep it outside OneDrive and the repository.
- Free VM: systemd reads root-only `/etc/team-dashboard.env`, data lives in `/var/lib/team-dashboard`, and Tailscale Serve proxies HTTPS to `127.0.0.1:3000`. The README retains Railway as an optional path.

## 5. Decisions log (append-only)
| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-11-26 | The owner pastes Attendance and MTD daily into a small restricted Google workbook. The dashboard reads it with the existing read-only Google sign-in. | Direct and browser-based reads of the original WFM workbook failed. | Automated reads of the original workbook. |
| 2026-11-26 | The coaching cycle starts on the 21st and ends on the 20th. Attendance history comes from daily Attendance rows. MTD is snapshotted by Cairo sync date and agent code. | Match the cycle used by WFM. | — |
| 2026-11-20 | Read sheets via public CSV export, no auth | Sheets open in incognito; Apps Script failed ("too large") and isn't allowed; viewer access only | Apps Script web app; Sheets API with OAuth (admin may block) |
| 2026-11-20 | Join on agent code, never name | TL/agent names differ between master and schedule | Name matching |
| 2026-11-20 | Schedule dates by anchor (col F = 2026-10-21) | Header day names break after col AA | Reading header dates |
| 2026-11-20 | `export` default, `gviz` only as fallback, never for schedule | gviz types each column and blanks minority-type cells | gviz everywhere |
| 2026-11-21 | Sync replaces only the source's covered date range | A new schedule/attendance version wiped up to 5 weeks of history (review bug #1) | Delete the whole window |
| 2026-11-21 | D5 id is `code\|D5` (first-seen date kept) | Daily ids buried TL comments (review bug #2) | Date in id |
| 2026-11-21 | Normalise AM/PM shift times | "6:00 PM" was read as 06:00 (review bug #3) | — |
| 2026-11-21 | Configurable `dateOrder`, any master column letter + `expectHeaders`, refuse sensitive headers | Real master layout/date format unconfirmed; inserted columns would silently misread | Hard-coded A–M letters, M/D only |
| 2026-11-22 | Repo is **public, final** (owner's call) | — | Private repo (recommended, declined) |
| 2026-11-22 | Post-plan workstreams B–F added: backups, check-a-link, attendance dry run, hardening/mobile/a11y, Cairo date edges | Owner wanted a long autonomous run | — |
| 2026-11-23 | `origin` = `barwezt-ops/MyTeamDashboard`; B–F moved there from the fork | They were pushed to the `travis-holt` fork by mistake | — |
| 2026-11-23 | Nightly backup logged as job `backup` in `sync_log` | Failures were console-only and invisible | — |
| 2026-11-23 | PRs merged with merge commits (not squash) | Keeps the stacked branches' history intact | Squash |
| 2026-11-23 | Bootstrap live data after listen when no successful roster is recorded | A new instance can respond to health checks immediately. A persisted successful roster prevents another boot sync. | Run All on every boot |
| 2026-11-23 | Report completed daily and successful roster timestamps on public health | A successful schedule fetch alone can precede a rules failure. Keep source, configuration, and team data behind login. | Expose authenticated sync status publicly |
| 2026-11-23 | Use a Google Cloud Free Tier e2-micro VM with Tailscale private HTTPS | The owner wants to avoid a recurring hosting bill. Use external IPv6 for normal operation and verify Tailscale plan eligibility for work use before going live. | Railway as the project's hosting target |
| 2026-11-23 | Use IPv6-only internet access in normal operation and attach ephemeral IPv4 for setup and every app update | GitHub access requires IPv4. Detaching it after maintenance limits address charges. | Keep external IPv4 attached full-time |
| 2026-11-24 | Run on the owner's Windows PC with SQLite in `%LOCALAPPDATA%\TeamDashboard\data`, outside OneDrive and the repository | The owner wants a local setup that needs no hosting account or payment card. Keeping a live database out of sync folders avoids corruption. | Free VM and Railway |
| 2026-11-24 | Compare completed daily and All start times with the latest elapsed Cairo slot | A manual All at 10:00 should leave the 16:00 sync due. Wake-up catches up from the most recent scheduled slot. | Treat any same-day success as sufficient |
| 2026-11-24 | Restore one boot-time All attempt when there is no successful roster | The first live instance should populate data even before the daily time. The check guards against duplicate bootstrap attempts. | Wait until the scheduled daily time |
| 2026-11-24 | Infer HTTPS for non-local hosts on live loopback listeners when the protocol header is absent | Tailscale Serve can omit `X-Forwarded-Proto`. Windows and the loopback-bound VM need secure session cookies, and direct localhost sign-in uses HTTP. | Require the header for every secure proxy sign-in |
| 2026-11-25 | Parse unambiguous English month names in the shared date parser | The live master exports dates with month names. `dateOrder` applies to numeric slash dates. | Special-case the roster or link diagnostic |

## 6. Known issues & tech debt

- The verified paste contains the previous coaching cycle. Attendance stays disabled pending review and activation.
| Issue | Impact | Planned fix |
|---|---|---|
| Sidebar stops partway down long pages and on phone | Cosmetic | Make it full-height/sticky |
| Check-a-link rejects multi-account links (`/spreadsheets/u/1/d/...`) | Minor friction | Accept and normalise `/u/N/` |
| Restore preview says "updated", not "X resolved flags will reopen" | Could surprise | Clearer preview wording |
| D5 reopen keeps the first-seen date | Optional | Owner to decide |
| Live master date sample pending post-merge check | The current main branch cannot parse the master export's month-name dates | Rerun `test-link` on the real master after the shared parser change merges |
| 5 superseded PRs still open on the `travis-holt` fork | Clutter | Owner closes them |
| Daily cron at 16:00 Cairo is a placeholder | May run before WFM updates attendance | Set once Q3 answered |
| The dashboard syncs only while the PC is awake and the owner is signed in | The web app and scheduled jobs pause while the PC is unavailable | Startup and 15-minute catch-up cover the latest elapsed daily slot and today's backup. |
| A Windows Group Policy can block PowerShell script files | The verification host had a restricted `MachinePolicy`, so Task Scheduler installation is pending a PC that allows the scripts | Use `Get-ExecutionPolicy -List` and ask the administrator to allow the scripts if needed. |
| Outbound networking and tailnet plan depend on owner setup | External IPv4 can incur charges and Tailscale Personal is for non-commercial use | Use the README IPv6 and IAP setup, verify an eligible tailnet, and check next-day sync and billing |
| App updates require a temporary IPv4 window | GitHub pulls cannot run over the VM's normal IPv6-only internet connection | Attach IPv4, run the update, then detach it. Apply Ubuntu security updates in the same window if APT cannot refresh over IPv6. |

## 7. Open questions for the owner
| # | Question | Blocking? | Status |
|---|---|---|---|
| Q1 | Attendance sheet link + tab, long or wide layout, and what counts as a discrepancy (missing punch / missing hours / late / no-show)? | Phase 6 | open |
| Q2 | Does the live master match `expectHeaders` and return a parsed sample date? | Phase 7 go-live | Headers verified. Date sample pending post-merge check. |
| Q3 | What time (Cairo) does WFM finish updating attendance? | daily cron time | open |
| Q4 | Does the schedule move to a new file/tab each month? (anchor + GID would change monthly) | schedule upkeep | open |
| Q5 | Any SOP thresholds for leave flags? | Trends badges | open (stays empty) |
| Q6 | STL sign-off before anyone else uses the live dashboard | go-live | open |

## 8. Review feedback
- **PR #1 review (2026-11-21): request changes → fixed → approved.** Must-fix: covered-range replacement, stable D5 id, AM/PM. Should-fix: scope unmatched wide-attendance warnings to team leads, any column letter + `expectHeaders` + refuse sensitive headers, `dateOrder`. Nits: "Not on schedule" separate from Unknown; copy schema.sql into dist. All addressed in 8 commits with tests.
- **B–F review (2026-11-22): all approved.** Should-fix (done 2026-11-23): log nightly backup to `sync_log`. Nits open: see §6.
- **PR #10 review (2026-11-24): fixes ready for review.** Compare successful runs with the scheduled Cairo slot, restore first-boot All, and adopt the secure-cookie fallback for loopback Tailscale hosts. Regression tests cover manual and scheduled runs, sleep/resume, bootstrap success and failure, and Windows, VM, and public-bind login behavior.
- **Process notes from reviews:** keep one phase per PR and stop at checkpoints; never push to the fork; memory.md/CLAUDE.md belong in the repo.

## 9. Changelog (append-only, newest first)

- PR #19 review set attendance reads to hourly all day in Cairo and allowed overnight windows. Attendance replaces only pasted agent/date pairs. A paste with fewer than half the prior successful paste's matched Attendance codes fails before attendance or MTD writes.
### 2026-11-26 — Restricted attendance paste workbook

- Replaced the proposed browser-session download with a small owner-maintained workbook. Verified all three tabs and ran an attendance preview with the existing read-only sign-in.
- Added configurable hourly sync and a stale badge. The sync stores daily history and MTD snapshots from whitelisted fields joined by agent code.

### 2026-11-25 — Master month-name dates and live source checks
- Added shared month-name date parsing with coverage for roster hire dates, last working days, and link diagnostic samples. Verified the dated schedule export and anchored range. Paused the Windows install for review.

### 2026-11-24 — PR #10 review fixes
- Updated daily catch-up to use the latest elapsed slot, restored first-boot All, and fixed secure session cookies for Tailscale Serve with loopback binding. Added the phone login check to the Windows runbook.

### 2026-11-24 — Windows local deployment
- Added Windows Task Scheduler scripts and the owner runbook, guarded local data paths, optional external live config, Cairo catch-up with hourly retry limits, and capped logs. Kept the Free VM and Railway runbooks as optional paths that need a card.
- Verified the Windows Node 20 SQLite prebuild, PowerShell syntax, hidden launcher and staged build locally. The optional Windows CI job needs GitHub workflow-write permission.

### 2026-11-23 — PR #9 review fixes
- Made temporary IPv4 mandatory for setup and updates, added GitHub reachability checks, and documented verifying APT over IPv6 and downloading a weekly off-VM backup. Setup enables unattended security updates and the dashboard unit uses a private temporary directory.

### 2026-11-23 — Free VM deployment path
- Added setup and staged update scripts, a loopback-only systemd unit, and the owner runbook for an e2-micro VM with Tailscale private HTTPS. Added live bind-address test coverage. Owner review and the live deployment are pending.

### 2026-11-23 — Phase 7 deploy readiness
- Added the writable-storage boot check, live bootstrap sync, and minimal public health response. Added regression tests for the boot failure, restart behavior, and public response.
- Added the fake live config with all ten master headers, attendance disabled, and the Railway runbook. Production deploy and scheduled-run verification are pending the owner at Checkpoint 7.
- Made the Playwright smoke launcher work on Windows and Linux through Node's `tsx` import hook.

### 2026-11-23 — Repo consolidation + merge + memory rebuild
- Moved B–F from the fork to `barwezt-ops`, added the backup-logging commit to B, rebased C–F (one-line conflict in `routes.ts` status jobs list), opened #2–#6, merged #1–#6 in order. Main: 126 tests, build OK, Playwright 4/4.
- Rebuilt CLAUDE.md, memory.md and a sanitised plan.md from the codebase and review history (originals were lost with the owner's machine).
### 2026-11-22 — Workstreams B–F (PRs #2–#6)
- B backups/restore, C check-a-link, D attendance dry run, E zod validation + mobile + a11y + perf (Today 81 ms, Trends 203 ms, Discrepancies 20 ms on 200 agents), F Cairo date boundaries (one date per sync run, DST, month/year edges).
### 2026-11-21 — PR #1 review fixes
- 8 commits: covered-range replacement, stable D5, AM/PM, scoped warnings, master column/header checks, dateOrder, Not-on-schedule card, schema in dist. 61 tests.
### 2026-11-21 — PR #1: Phases 0–5 in one PR
- Skeleton, fetch/parse/roster, schedule, rules D5–D7 + API, UI, trends. 37 tests, 97% coverage.
### 2026-11-20 — Plan v2
- Public-link route chosen; plan.md written.
