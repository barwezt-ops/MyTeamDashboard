# memory.md — Team Dashboard
_Last updated: 2026-11-27 for the V2 review follow-up on PR #27._

> Public repo: no real names, codes, sheet IDs or env values in this file. Refer to config keys (e.g. `sources.master.sheetId`) and roles ("the owner", "the covered TL", "the STL").

## 1. Snapshot
- **V2 status:** plan-v2 Phases 1–8 are built on stacked branches with one open PR each, none merged: #20 design system (approved), #21 data layer, #22 Home, #23 grid and Team, #24 agent profile, #25 Coaching, #26 Quality and Queues, #27 Reports, Settings and polish. Merge in that order; after each merge, point the next PR at `main`.
- **Branches:** `v2-phase-1-design-system` → `-2-data` → `-3-home` → `-4-grid` → `-5-profile` → `-6-coaching` → `-7-quality-queues` → `-8-reports-settings` (all prefixed `v2-phase`).
- **Review follow-up:** the owner reviewed PRs #21–#27 and approved them with 15 fixes and decisions (plan-v2 section 8). All are done as follow-up commits on `v2-phase-8-reports-settings` (PR #27), waiting for review. The earlier branches are unchanged, so merge the whole stack before using any one phase.
- **Handover:** on 2026-11-27 a new session took over from the previous one for the review follow-up. The tree was clean at `03d10cc`, matched origin, and had no stashes or unpushed work. (An earlier handover on 2026-11-26 recovered unpushed Phase 2 work; nothing was discarded.)
- **Tests on the Phase 8 branch:** 242 Vitest tests passed, one existing skip; 25 Playwright tests passed. Lint, typecheck and the isolated build pass.
- **Installed database:** on 2026-11-27 the `owner_settings` table was added and `absentDays = 1` saved, at the owner's request. A copy taken first is in the data folder as `dashboard.before-absent-days.db`. The installed release ignores the table until it is updated.
- **Installed app:** still runs the pre-V2 release. `server/dist` in this checkout is a junction into it, so never run `npm run build` here; use `npm run build:smoke`. Run unit tests from PowerShell, not Git Bash (its `whoami.exe` breaks the Google token tests).
- **2026-11-26 attendance checkpoint:** The Windows dashboard is installed. The owner approved importing the prior coaching cycle from the restricted workbook. Attendance is enabled through the read-only Google source. One attendance sync succeeded and the restarted dashboard passed its health check.
- **v1 status:** plan.md Phases 0–5 and workstreams B–F are merged to `main`, as are Windows local deployment and the attendance paste sync.
- **Next task:** the owner reviews the follow-up, merges the V2 PRs, updates the installed app, runs an attendance sync (which fills in break minutes for the pasted days), sets the account, report layout, thresholds and staffing in Settings, connects the line/queue tab, and sends the QA link.

## 2. Features
- **V2 review follow-up (2026-11-27):** whole-coaching pace; the perfect-attendance rule; break minutes everywhere; the MTD-against-daily warning (freshness line and Settings, by name); every Team View column in Team; a nameless end-of-day report; the attendance email table and subject; escalation headings, documentation order and an MPR layout in Settings; read-only status map with unmapped labels (`v2/statusMap.ts`, `GET /v2/status-map`); one date format; Attendance → Trends replacing the Trends screen (`views/AttendanceTrends.tsx`); Home exceptions and shout-out layout (`web/test/layout.spec.ts`).
- **V2 Phase 8:** Reports (end of day in the owner's layout, cycle summary, MPR prep, roster changes, all copy and CSV), Settings (thresholds marked set or not set, cycle and attendance read hours, staffing baselines, report layout, theme, status map), Ctrl K “Copy EOD”, custom form controls and a quality-bar browser test (`v2/reports.ts`, `v2/template.ts`, `views/Reports.tsx`, `views/OwnerSettings.tsx`). `GET /v2/reports?cycle&date`.
- **V2 Phase 7:** Quality (latest, cycle and previous average, recent scores, last evaluation, distribution, sorting, owner-set overdue mark, prep links) and Queues (today's board, 14-day coverage against owner baselines, 31-day leave list, line changes). `GET /v2/quality`, `GET /v2/queues`.
- **V2 Phase 6:** Coaching overview (ring, pace, needs-it-most order), prep sheet with facts and question prompts, log form with linked evidence and optional measurable step, follow-ups, filterable history with Copy as documentation and CSV, and per-agent fairness counts (`v2/coaching.ts`, `views/Coaching.tsx`). `GET /v2/coaching`, `GET /v2/coaching/prep/:code?cycle`.
- **V2 Phase 5:** profile header with new-hire stage, open flags with dismiss-with-reason, scorecard against the team average, cycle calendar, six-cycle trends, patterns, coaching timeline with kept/not kept, private tagged notes, discrepancy history, MPR prep and escalation drafts (`v2/profile.ts`, `v2/documents.ts`, `views/Agent.tsx`). `GET /v2/agents/:code`.
- **V2 Phase 4:** attendance grid (sticky names and days, plan outlines, late/missing marks, tooltip, day drawer, arrow-key navigation, row and column totals, line/status/flagged filters, cycle switcher, CSV) and Team table (sorting, column picker, density, saved views in owner settings, CSV, deltas against the previous cycle). `GET /v2/grid?cycle`, `GET /v2/team?cycle`.
- **V2 Phase 3:** Home with greeting and generated summary, urgent strip, floor card, four KPIs against the cycle daily average, coaching ring, Needs you, week heatmap, queues today, yesterday's exceptions with Copy for EOD, 14-day lateness and shout-out (`v2/home.ts`, `views/Home.tsx`). One-line source freshness, live nav counts, `GET /v2/home` and `/v2/counts`. A synthetic 16-agent team (`fixtures/team.ts`, test port 3212) drives V2 screen tests; `SAVE_SCREENSHOTS=1` refreshes `docs/design/`.
- **V2 Phase 2 (API only, no screens yet):**
  - Sources (off by default): line/queue tab with change history and weekly-template fallback; QA with headers-only inspection and a mapping that needs owner approval (`server/src/v2/sources.ts`).
  - Owner records: coaching with checked evidence and follow-ups, private tagged notes, flag dismissals, settings; all in backups (`routes.ts`, `backup.ts`).
  - Logic: cycle utilities, attendance day facts, flags engine, factual patterns, agreed-step outcomes and sentence templates (`cycle`, `facts`, `flags`, `patterns`, `outcomes`, `templates`).
- **V2 Phase 1:** Self-hosted fonts, editorial tokens, responsive forest sidebar and bottom navigation, Cairo greeting/cycle header, source freshness, Ctrl/Cmd K search, component styleguide, native dialogs and notifications. Owner-only UI scope; later screens show explicit phase placeholders.
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
| Restricted attendance paste | Enabled with owner approval | `fetch/attendancePaste.ts`, `sync/attendancePaste.ts` | Header-based reads, agent/date replacement, daily MTD snapshots, and hourly checks all day by default in Cairo. |
| Rules D1–D7 | done (D1–D4 run only when attendance enabled) | `rules/` | D5 has stable id `code\|D5`; auto-clear only touches `open` rows |
| Sync windows / replacement | done | `sync/service.ts`, `syncSchedule.ts`, `syncAttendance.ts` | window = today −35 / +14; replace only the dates the source covers (`coveredRange`); one Cairo date per run |
| Cron and catch-up | done | `sync/cron.ts` | daily `0 16 * * *`, weekly `0 12 * * 0` (Sun), backup 02:00 Cairo. Startup and 15-minute checks cover the latest elapsed daily slot and today's backup. A successful daily or All must start at or after the slot to satisfy it. Automated retries wait at least one hour. Daily refreshes roster first if missing or >7 days old. |
| Auth | done | `auth.ts` | single bcrypt password in env, signed cookie session (12 h), login rate limit. Loopback live listeners allow direct localhost HTTP sign-in and use secure cookies for Tailscale hostnames even when Serve omits `X-Forwarded-Proto`. |
| API with zod validation | done | `api/routes.ts`, `api/request.ts` | see §3 |
| Copy as email table | done | `api/export.ts` | Code \| Name \| Team Leader \| Account \| Date \| Missing \| TL Comment; header `#16365c` white bold; black 1 px borders; Arial 11 pt |
| Backups + restore | done | `backup/` | nightly 02:00 Cairo to `DATA_DIR/backups`, keep 14; logged as job `backup` in `sync_log`; restore = preview token → confirm, one transaction, never touches schedule/attendance |
| Check a sheet link (UI + CLI) | done | `fetch/checkLink.ts`, Settings | docs.google.com only, URL rebuilt server-side, manual redirects only to Google export hosts, 32 MB cap, 5/min, sensitive-looking headers hidden |
| Views: Login, V2 screens, Discrepancies, Agent, Settings | done | `web/src/views/` | Today, Trends and Roster retired 2026-11-27; their old URLs go Home. Light/dark, 390 px phone layout, keyboard + aria, axe clean |
| First live boot and public health | done | `index.ts`, `db/db.ts`, `sync/cron.ts` | Startup checks `DATA_DIR`, then starts catch-up after listening. With no successful roster, the first check starts All once at any Cairo hour. Public health returns only `ok`, `version`, and `lastSyncAt`. |
| Windows local deployment | **merged, install pending** | `deploy/windows/`, `README.md`, `env.ts` | Task Scheduler starts at sign-in. The app binds to `127.0.0.1` and rotates logs in the local data folder. Updates build separately and check health after switching. |
| Free VM and Railway | optional, needs a card | `deploy/`, `README.md` | Existing deploy runbooks remain available. |
| Real attendance mapping | **not done** | — | Phase 6, blocked on link |

## 3. Architecture as built
- **One Node 20 service** (Express 4) does sync jobs (node-cron), API and serves the built Vite/React app. SQLite via better-sqlite3 at `DATA_DIR/dashboard.db`. `schema.sql` is copied into `server/dist` at build.
- **Data flow:** public CSV export → parse (whitelisted columns only) → filter to team codes → upsert in one transaction per job → rules → API → UI.
- **API (all need a session except login/health):** `POST /login`, `POST /logout`, `GET /health`, `GET /me`, `GET /today?scope&date`, `GET /discrepancies?scope&state&rule&from&to&q&code`, `PATCH /discrepancies/:id`, `PATCH /discrepancies/bulk`, `GET /discrepancies/export`, `GET /trends?scope&from&to`, `GET /agents?scope`, `GET /agents/:code`, `POST /agents/:code/notes`, `PATCH /notes/:id`, `GET /roster/events?scope&since`, `GET /sync/status`, `POST /sync?job=roster|daily|all`, `POST /sync/attendance-preview`, `POST /check-link`, `GET /backup`, `POST /backup/preview`, `POST /backup/restore?token`. V2: `GET /v2/data?cycle`, `GET|PATCH /v2/settings`, `POST /v2/coachings`, `PATCH /v2/followups/:id`, `POST /v2/notes`, `PATCH|DELETE /v2/notes/:id`, `POST /v2/flags/dismiss`, `GET /v2/home|counts|grid|team|agents/:code|coaching|coaching/prep/:code|quality|queues|reports|status-map`. `GET /today` and `GET /roster/events` have had no screen since 2026-11-27.
- **Scopes:** `mine` (owner's agents), `covered` (+ covered TL's agents, default), `all`.
- **Tables:** agents, roster_snapshots, roster_events, schedule_days, attendance_days, discrepancies, notes, sync_log, attendance_paste_details, attendance_mtd_snapshots, attendance_paste_state, line_history, qa_evaluations, coachings, coaching_followups, private_notes, flag_dismissals, owner_settings. All V2 tables are additive, so schema version stays 2.

## 4. Config & environment
- Sample config: `config/sources.json` (fake names, empty IDs). Live config: gitignored `config/sources.local.json`, the private path in `DASHBOARD_CONFIG_FILE`, or full JSON in `DASHBOARD_SOURCE_CONFIG` for optional hosts.
- Keys that matter for go-live: `me.rosterName`, `me.alsoCover`, `dateOrder` (`MDY`/`DMY`), `sources.*.sheetId` / `gid`, `sources.master.expectHeaders` (**set it** — it's what catches inserted columns), `sources.schedule.anchor`, `sources.attendance.enabled` (keep false until Phase 6), `thresholds` (empty).
- V2 keys: `sources.lineQueue` (`enabled`, `sheetId`, `gid`, optional `headers`), `sources.qa` (`enabled`, `mappingApproved`, `columns`), `sources.attendance.paste.breakExceededLabel` (default `Exceeded`). V2 thresholds live in the database (`owner_settings`); only lateness incidents ships set (3). Report settings there: `reportTemplate`, `reportAccount`, `emailSubject`, `mprTemplate`. The attendance paste requires the `Duration Of break Exceeding` header (column AG in the live workbook).
- Env var names: `PORT`, `BIND_HOST`, `DATA_DIR`, `DASHBOARD_PASSWORD_HASH`, `SESSION_SECRET`, `SOURCE_MODE` (`fixture`|`live`), `TZ`, `DASHBOARD_SOURCE_CONFIG`, `DASHBOARD_CONFIG_FILE`.
- Windows run: follow the README to prepare `.env` and live config, check sheet links, run `deploy/windows/install.ps1`, and use **Settings → Sync now → All**. An empty `DATA_DIR` uses `%LOCALAPPDATA%\TeamDashboard\data`. Keep it outside OneDrive and the repository.
- Free VM: systemd reads root-only `/etc/team-dashboard.env`, data lives in `/var/lib/team-dashboard`, and Tailscale Serve proxies HTTPS to `127.0.0.1:3000`. The README retains Railway as an optional path.

## 5. Decisions log (append-only)
- 2026-11-26: V2 supersedes the v1 visual scope: owner's team only in UI and defaults; keep covered-team model regression coverage explicit. No new thresholds, source syncs or coaching storage in Phase 1. The queue template and greeting name remain only in ignored local config.
- 2026-11-26: Bundle Fontsource fonts; use muted small labels and darker warning tag text for contrast while keeping the supplied decorative tokens. Native dialogs provide modal focus behavior.
- 2026-11-26: Build smoke artifacts into `server/dist.test`. The installed checkout's `server/dist` is a release junction; initial test compilation touched its compiled server files, which were restored from HEAD without restarting or syncing the live app.
| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-11-27 | Owner: NCNS/AWOL is URGENT from the first day in a cycle. Saved as `absentDays = 1` in local settings; the shipped default stays empty. | Owner's call (Q7). | Shipping 1 as a default |
| 2026-11-27 | Owner: expected coachings = floor(target × elapsed ÷ total). Behind and SOON only when done is below it. A dismissed pace item returns when the next coaching falls due. Supersedes the fractional pace. | Owner's call (Q8). | 2 × elapsed ÷ total |
| 2026-11-27 | Owner: perfect attendance ends with lateness, missing time, UPL (incl. forced), Casual, NCNS or AWOL, whole or half day; annual, sick, public holiday and off are allowed. | Owner's call (Q10). | Sick as disqualifying |
| 2026-11-27 | Implementation: any other `Absent` status also ends it, as do MTD lateness or missing totals. An unmapped status does not. The wording says “perfect attendance”, since sick days are now allowed. | Never praise someone WFM shows late; do not guess what an unmapped label means. | “Haven't missed a minute” |
| 2026-11-27 | Owner: break minutes come from `Duration Of break Exceeding`; `Exceeded` stays the flag signal. Supersedes the two earlier no-minutes decisions: that column was not the one being read. Verified read-only: all 40 exceeded team rows carry minutes as day fractions. | Owner's call (Q9). | Counts only |
| 2026-11-27 | MTD check compares each team agent's MTD lateness with the stored daily rows of the latest pasted cycle; a minute or more differs, a blank MTD cell means none. The sync log keeps codes; names are resolved for display. | Compare what the dashboard actually holds; keep names out of logs. | Comparing only the rows in the current paste |
| 2026-11-27 | Team View parity is built from synced data under the sheet's labels. The live headers were checked and match. The tab is still not read. “MTD UPL” is the MTD `UPL` count; forced UPL keeps its own column. | Whitelisted columns only. | Reading the Team View tab |
| 2026-11-27 | Owner: no agent names in the end-of-day report. Name placeholders read `Agent`; `{team.*_agents}` counts read “1 Agent” / “3 Agents”; rows sort by line then code. | The report goes outside the team. | Removing the placeholders |
| 2026-11-27 | The attendance email lists agents with missing time on the report date. TL Comment is blank. | The columns end in “Missing”; the owner has not asked for other rows (Q15). | Listing every exception |
| 2026-11-27 | Documentation copies the owner's five fields, adding Agent only when several agents are copied. CSV keeps Agent and ISO dates. | A mixed list is unreadable without names; sheets sort ISO dates. | Always naming the agent |
| 2026-11-27 | Owner: Today, Trends and Roster retired. Trends' date ranges, status totals and chart, per-agent counts, discrepancy counts and threshold badges moved to Attendance → Trends. The unused APIs stay. Not carried over: Today's any-date list, Roster's DTL and tenure columns. | Owner's call (Q13); only Trends was to be checked and ported. | Dropping the trend views |
| 2026-11-27 | The sidebar was not restructured. In Chromium at 1440×900, scrolled to the bottom of a profile, no paper shows under it; the short column only appeared in full-page captures. Screenshots now use a window as tall as the page. | The owner asked for the change only if paper shows. | A full-height column with a sticky nav |
| 2026-11-27 | The report layout is the owner's pasted table: a line with `{row.…}` repeats per agent and `{exception.…}` per exception. Home and Ctrl K copy the same layout. | One layout, filled from data. | Fixed report columns |
| 2026-11-27 | Attendance read hours chosen in Settings override the config file. The status map stays read-only in the app. | Hours are an owner preference; mapping changes affect sync parsing and stay in config. | Editing the status map in the app |
| 2026-11-27 | QA distribution bands (under 80, 80s, 90s) are display bins only. “Overdue” appears only once the owner sets the number of days. | No invented thresholds. | — |
| 2026-11-27 | The leave calendar is a dated list of consecutive leave for the next 31 days. Coverage marks days filled from the weekly template. | A list reads on a phone and shows estimated days honestly. | — |
| 2026-11-27 | Pace counts today as one of the days left. “Needs it most” sorts by open urgent flags and due follow-ups, then fewest coachings this cycle, then longest since the last. | plan-v2 section F order. | — |
| 2026-11-27 | Fairness shows counts only, sorted by name, for this cycle or all time. Notes include private and earlier notes. | No judgement or ranking. | — |
| 2026-11-27 | A measured next step is optional and records a limit the owner enters; nothing is measured otherwise. | No invented targets. | — |
| 2026-11-27 | New notes are private tagged notes. Earlier v1 notes stay readable and can be marked done; they are no longer created in the UI. | V2 separates the coaching log from private notes. The v1 API is unchanged. | — |
| 2026-11-27 | MPR and escalation drafts leave out private notes unless the owner ticks them, and are editable before copying. | Notes are exported only when the owner asks. | — |
| 2026-11-27 | The owner's kept or not kept mark overrides the data-derived outcome. | Owner-entered judgement wins over inference. | — |
| 2026-11-27 | Mid-cycle deltas compare with the same number of days of the previous cycle; complete cycles compare in full. Overtime and deducted days have no delta because they only exist as MTD totals. | A part cycle against a full one would show every number falling. | — |
| 2026-11-27 | Team table columns come from the synced roster, daily and MTD fields (including MTD status counts). The Team View tab itself is not read. | Only whitelisted columns are mapped, and no Team View columns are approved beyond the code. | — |
| 2026-11-27 | Saved Team views are stored with owner settings. | They are owner-entered data and belong in backups. | — |
| 2026-11-27 | Home reports the latest recorded attendance day and names it when it is not yesterday. | Attendance arrives a day behind and must never read as today's. | — |
| 2026-11-27 | The coaching ring counts at most the target per agent; several pace items collapse into one Needs you line; the summary counts due follow-ups, not pace. | Extra coachings for one agent do not cover another, and Home stays calm. | — |
| 2026-11-27 | Break-exceed KPI and table show counts and the label, with no minutes. | The source has none. | — |
| 2026-11-27 | MTD `Lateness mins` is a duration (h:mm:ss) despite its header. The interrupted change that read it as plain minutes was reverted. | The Sheets API returns a day fraction equal to the sum of daily Lateness. Checked read-only on the installed database (aggregates only): 15 of 16 agents match. | Treat the number as minutes |
| 2026-11-27 | A break exceed is a per-day flag from the `Exceeded` label. No break minutes are shown. | The column holds only that label or nothing. | Parse minutes (always zero on real rows) |
| 2026-11-27 | Line/queue and QA syncs run after attendance and rules; their failure marks the run failed. | An optional tab must not hold back attendance. | Stop the run at the first failure |
| 2026-11-27 | A blank dated schedule cell counts as no entry, so the weekly template applies. Unrecognised text stays Unknown. | plan-v2 allows the template when there is no entry. | Treat blank as a dated entry |
| 2026-11-27 | A dismissal stores the flag's fact keys and reopens only when a new key appears. | Re-syncs and corrections that remove facts are not new facts. | Hash of whole records |
| 2026-11-27 | Count thresholds fire at or above the set number; QA fires below it. Missing-day windows end yesterday. NCNS/AWOL has an empty threshold and otherwise shows as LATER. | Match "3 or more"; attendance covers the previous day; NCNS/AWOL urgency is the owner's call. | — |
| 2026-11-27 | Use MTD totals once their snapshot is newer than the latest daily row, else add up daily rows. | MTD is WFM's own figure. | Daily only |
| 2026-11-27 | Display rules for LATER patterns: weekday lateness on at least 3 and a majority of the last 5 recorded weekdays; missing time after OFF at least twice; exceeded breaks 2+ worked days running. | Factual and quiet. These never raise urgency. | — |
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
- The line/queue tab has not been connected and QA is waiting for its link.

- The owner approved importing the prior coaching cycle. Its MTD totals are saved under the Cairo sync date with the source cycle recorded.
| Issue | Impact | Planned fix |
|---|---|---|
| The discrepancy review still uses the older layout | Looks different from V2 | Restyle when asked |
| Days stored before this change have no break minutes | They read “Exceeded” | The next attendance sync fills in every day still in the paste |
| Team column choices reset when the cycle changes | Re-pick or use a saved view | Keep the choices across cycles |
| One agent's MTD lateness differs from the daily sum on the live paste (one agent's MTD missing hours differ too) | The dashboard shows MTD totals beside daily dates and, once updated, warns by name | Owner to check the workbook |
| `npm run build` writes through the `server/dist` junction | Would overwrite the installed app | Use `build:smoke` in this checkout |
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
| Q7 | Should NCNS/AWOL be URGENT, and from how many days per cycle? | no | answered 2026-11-27: urgent from 1 day |
| Q8 | "Behind pace" is done < 2 × elapsed ÷ total, so everyone at 0 is behind from day 1. Is that intended, or only once a whole coaching is due? | no | answered 2026-11-27: whole coachings only |
| Q9 | The paste has no break-exceed minutes. Is there a column with them? | no | answered 2026-11-27: column AG |
| Q10 | Does a shout-out ("clean record") mean no lateness, missing time or unplanned absence, with planned leave allowed? | no | answered 2026-11-27: see decisions |
| Q11 | Does the Team View tab have any column the Team table lacks? Send its header row to approve new mappings. | no | answered 2026-11-27: parity added from synced data |
| Q12 | Are the prep-sheet question prompts right for your conversations? They are listed in `v2/coaching.ts`. | no | open |
| Q13 | Retire the older Today, Trends and Roster screens now that V2 covers them? | no | answered 2026-11-27: retired |
| Q14 | Do you have a fixed MPR or escalation layout? | no | answered 2026-11-27: see decisions |
| Q15 | Should the attendance email also list NCNS/AWOL days or lateness, or only missing time? | no | open |
| Q16 | The shout-out also ends on an unlabelled Absent and on MTD lateness or missing totals, and ignores unmapped statuses. Is that right? | no | open |
| Q17 | Should “MTD UPL” include forced and half-day UPL counts? | no | open |

## 8. Review feedback
- **PRs #21–#27 review (2026-11-27):** approved with 15 fixes and decisions (plan-v2 section 8). Done on PR #27, awaiting review.
- **PR #20 design approved with five fixes:** viewport-sticky sidebar and internal nav scroll, greeting-name initials, smaller phone KPI values without sparklines, Floor phone wordmark/logout in Settings, and bottom-nav safe-area clearance. Regression coverage checks all current pages at 390px. Phases 2?8 are authorized after this gate.
- **PR #1 review (2026-11-21): request changes → fixed → approved.** Must-fix: covered-range replacement, stable D5 id, AM/PM. Should-fix: scope unmatched wide-attendance warnings to team leads, any column letter + `expectHeaders` + refuse sensitive headers, `dateOrder`. Nits: "Not on schedule" separate from Unknown; copy schema.sql into dist. All addressed in 8 commits with tests.
- **B–F review (2026-11-22): all approved.** Should-fix (done 2026-11-23): log nightly backup to `sync_log`. Nits open: see §6.
- **PR #10 review (2026-11-24): fixes ready for review.** Compare successful runs with the scheduled Cairo slot, restore first-boot All, and adopt the secure-cookie fallback for loopback Tailscale hosts. Regression tests cover manual and scheduled runs, sleep/resume, bootstrap success and failure, and Windows, VM, and public-bind login behavior.
- **Process notes from reviews:** keep one phase per PR and stop at checkpoints; never push to the fork; memory.md/CLAUDE.md belong in the repo.

## 9. Changelog (append-only, newest first)

### 2026-11-27 - V2 review follow-up (new session)
- Took over from the previous session with a clean tree at `03d10cc`.
- Did the 15 review items as focused commits on `v2-phase-8-reports-settings`, with unit and browser tests and refreshed screenshots (new: Attendance trends).
- Fixed a bug found on the way: two settings forms shared a React key, which would have repeated the report layout form.
- Saved `absentDays = 1` in the installed database after backing it up. Checked read-only on live data that the break column parses, the MTD warning would name one agent, and no status label is unmapped.

### 2026-11-27 - V2 Phase 8 Reports, Settings and polish
- Built Reports and the owner settings, replaced browser-default controls, fixed older Settings panel spacing, and added the quality-bar, reports and settings tests with screenshots. Browser tests now share one signed-in session to stay under the sign-in limit. Screenshots from earlier phases were refreshed for the shared control styles.

### 2026-11-27 - V2 Phase 7 Quality and Queues
- Built both screens with unit and browser tests and screenshots. The content column can no longer grow past the viewport.

### 2026-11-27 - V2 Phase 6 Coaching hub
- Built the hub with unit and browser tests and 1440/390 screenshots. Home's Coach and Review buttons open it.

### 2026-11-27 - V2 Phase 5 agent profile
- Replaced the v1 agent view; updated the older note tests to private notes; added unit and browser tests and screenshots.

### 2026-11-27 - V2 Phase 4 grid and Team table
- Built both screens with unit and browser tests and 1440/390 screenshots.

### 2026-11-27 - V2 Phase 3 Home
- Built Home to the v3 mockup with shared heat, queue and view-model modules, unit tests, browser tests and 1440/390 screenshots.
- Made the older layout test tolerate sub-pixel scroll positions.

### 2026-11-27 - V2 Phase 2 data layer (handover)
- Took over from an interrupted session. Recovered the unpushed Phase 2 work on `v2-phase-2-data` and backed it up before editing.
- **Correction:** reverted its MTD lateness change to the day-fraction to duration handling and added a test that MTD lateness equals the sum of daily lateness per agent, including totals over 24 hours.
- Fixed gaps found against plan-v2: exceeded-break parsing, queue sync blocking attendance, dismissals reopening on unrelated changes, line history dates in UTC, QA inspection hiding which headers failed. Added private notes, agreed-step outcomes, cycle utilities, sentence templates, NCNS/AWOL setting, line history in backups and `test-link --source=lineQueue`.
- Kept the previous agent's test-only timing fix to `review-layout.spec.ts` as its own commit.

### 2026-11-26 - Phase 1 approved review fixes
- Addressed all five design notes, refreshed the synthetic desktop/phone screenshots, and added a browser regression test for sticky navigation, initials, KPI overflow, logout placement and the last content edge on each page. Six browser specs passed.

### 2026-11-26 - V2 Phase 1 design system and app shell

- Saved the supplied build plan and mockup unchanged. Added the reusable component layer, styleguide, shell navigation, private-config greeting, local fonts and owner-only UI scope. Kept existing v1 screens operational and later screens as placeholders.
- Validation: 181 unit tests passed with one existing skip; six Playwright specs, lint, typecheck and isolated production build passed. Added unit coverage for Cairo/cycle labels, deterministic avatars, owner-team defaults and source freshness. Playwright covers the styleguide, keyboard dialogs/search, source failures, contrast, five widths and synthetic screenshots. Test builds use an isolated server output; the installed app was not restarted or synced.

### 2026-11-26 — Attendance activated

- Enabled the restricted Google attendance paste after explicit owner approval of the prior cycle. Ran the existing Attendance sync service once, verified successful attendance and rule logs, and restarted the dashboard successfully. Browser control was unavailable, so the service was invoked directly.

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
