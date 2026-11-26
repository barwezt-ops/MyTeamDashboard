# memory.md — Team Dashboard
_Last updated: 2026-11-27 for V2 Phase 5 (Agent profile)._

> Public repo: no real names, codes, sheet IDs or env values in this file. Refer to config keys (e.g. `sources.master.sheetId`) and roles ("the owner", "the covered TL", "the STL").

## 1. Snapshot
- **V2 Phase 5:** on `v2-phase-5-profile`, stacked on Phase 4 (PR #23). The agent drawer and `/agent/:code` use the V2 profile.
- **V2 Phase 4:** on `v2-phase-4-grid`, stacked on Phase 3 (PR #22). `/attendance` is the cycle grid, `/team` the Team table. The discrepancy queue stays at `/discrepancies` (linked from the grid) and the v1 roster view at `/roster`.
- **V2 Phase 3 (Home):** on `v2-phase-3-home`, stacked on Phase 2 (PR #21). The v1 Today list moved to `/today` (command palette).
- **V2 Phase 2 (data layer):** done on `v2-phase-2-data`, stacked on `v2-phase-1-design-system` (PR #20 approved, still open). This session took over from an interrupted agent: its uncommitted Phase 2 work was recovered, reviewed and finished, and nothing was discarded. Phases 3–8 follow on stacked branches.
- **Tests on the Phase 5 branch:** 217 Vitest tests passed, one existing skip; 13 Playwright specs passed. Lint, typecheck and the isolated build pass.
- **Installed app:** `server/dist` in this checkout is a junction into the live release. Never run `npm run build` here; use `npm run build:smoke`. Run unit tests from PowerShell, not Git Bash (its `whoami.exe` breaks the Google token tests).
- **V2 checkpoint:** Phase 1 design system and shell are implemented on `v2-phase-1-design-system`, open for review in PR #20. The owner approved the design with five fixes and authorized Phases 2?8 on stacked branches without merging. See `plan-v2.md` and `docs/design/phase-1-review.md`.
- **2026-11-26 attendance checkpoint:** The Windows dashboard is installed. The owner approved importing the prior coaching cycle from the restricted workbook. Attendance is enabled through the read-only Google source. One attendance sync succeeded and the restarted dashboard passed its health check.
- **Phase status:** plan.md Phases 0–5 done (PR #1). Post-plan workstreams B–F done (PRs #2–#6). **All merged to `main` on 2026-11-23.**
- **Remaining for v1 (plan.md §18):** Phase 6 real attendance mapping (blocked on the attendance link). Windows local deployment support merged in PR #10.
- **What works now (fixture mode and, once configured, live):** roster sync (weekly), schedule sync (daily), rules D5–D7, all dashboard views, notes, discrepancy comments/states, copy-as-email table, backups + restore, check-a-link, attendance dry run, password login.
- **Windows setup checkpoint:** Node 20 x64 dependencies are installed and the private live config is in place with attendance disabled. Both source exports responded, all ten master headers match, and the dated schedule passed the anchor check. Installation is pending review and merge of the month-name date fix.
- **Next task:** Pull the merged fix, rerun the master link check, then resume **Run on your Windows PC** at the installer. Verify health and run **Settings → Sync now → All**. Check the next daily sync and 02:00 Cairo backup after installation.

## 2. Features
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
| Views: Login, Today, Discrepancies, Trends, Roster, Agent, Settings | done | `web/src/views/` | light/dark, 390 px phone layout, keyboard + aria, axe clean |
| First live boot and public health | done | `index.ts`, `db/db.ts`, `sync/cron.ts` | Startup checks `DATA_DIR`, then starts catch-up after listening. With no successful roster, the first check starts All once at any Cairo hour. Public health returns only `ok`, `version`, and `lastSyncAt`. |
| Windows local deployment | **merged, install pending** | `deploy/windows/`, `README.md`, `env.ts` | Task Scheduler starts at sign-in. The app binds to `127.0.0.1` and rotates logs in the local data folder. Updates build separately and check health after switching. |
| Free VM and Railway | optional, needs a card | `deploy/`, `README.md` | Existing deploy runbooks remain available. |
| Real attendance mapping | **not done** | — | Phase 6, blocked on link |

## 3. Architecture as built
- **One Node 20 service** (Express 4) does sync jobs (node-cron), API and serves the built Vite/React app. SQLite via better-sqlite3 at `DATA_DIR/dashboard.db`. `schema.sql` is copied into `server/dist` at build.
- **Data flow:** public CSV export → parse (whitelisted columns only) → filter to team codes → upsert in one transaction per job → rules → API → UI.
- **API (all need a session except login/health):** `POST /login`, `POST /logout`, `GET /health`, `GET /me`, `GET /today?scope&date`, `GET /discrepancies?scope&state&rule&from&to&q&code`, `PATCH /discrepancies/:id`, `PATCH /discrepancies/bulk`, `GET /discrepancies/export`, `GET /trends?scope&from&to`, `GET /agents?scope`, `GET /agents/:code`, `POST /agents/:code/notes`, `PATCH /notes/:id`, `GET /roster/events?scope&since`, `GET /sync/status`, `POST /sync?job=roster|daily|all`, `POST /sync/attendance-preview`, `POST /check-link`, `GET /backup`, `POST /backup/preview`, `POST /backup/restore?token`. V2: `GET /v2/data?cycle`, `GET|PATCH /v2/settings`, `POST /v2/coachings`, `PATCH /v2/followups/:id`, `POST /v2/notes`, `PATCH|DELETE /v2/notes/:id`, `POST /v2/flags/dismiss`.
- **Scopes:** `mine` (owner's agents), `covered` (+ covered TL's agents, default), `all`.
- **Tables:** agents, roster_snapshots, roster_events, schedule_days, attendance_days, discrepancies, notes, sync_log, attendance_paste_details, attendance_mtd_snapshots, attendance_paste_state, line_history, qa_evaluations, coachings, coaching_followups, private_notes, flag_dismissals, owner_settings. All V2 tables are additive, so schema version stays 2.

## 4. Config & environment
- Sample config: `config/sources.json` (fake names, empty IDs). Live config: gitignored `config/sources.local.json`, the private path in `DASHBOARD_CONFIG_FILE`, or full JSON in `DASHBOARD_SOURCE_CONFIG` for optional hosts.
- Keys that matter for go-live: `me.rosterName`, `me.alsoCover`, `dateOrder` (`MDY`/`DMY`), `sources.*.sheetId` / `gid`, `sources.master.expectHeaders` (**set it** — it's what catches inserted columns), `sources.schedule.anchor`, `sources.attendance.enabled` (keep false until Phase 6), `thresholds` (empty).
- V2 keys: `sources.lineQueue` (`enabled`, `sheetId`, `gid`, optional `headers`), `sources.qa` (`enabled`, `mappingApproved`, `columns`), `sources.attendance.paste.breakExceededLabel` (default `Exceeded`). V2 thresholds live in the database (`owner_settings`); only lateness incidents ships set (3).
- Env var names: `PORT`, `BIND_HOST`, `DATA_DIR`, `DASHBOARD_PASSWORD_HASH`, `SESSION_SECRET`, `SOURCE_MODE` (`fixture`|`live`), `TZ`, `DASHBOARD_SOURCE_CONFIG`, `DASHBOARD_CONFIG_FILE`.
- Windows run: follow the README to prepare `.env` and live config, check sheet links, run `deploy/windows/install.ps1`, and use **Settings → Sync now → All**. An empty `DATA_DIR` uses `%LOCALAPPDATA%\TeamDashboard\data`. Keep it outside OneDrive and the repository.
- Free VM: systemd reads root-only `/etc/team-dashboard.env`, data lives in `/var/lib/team-dashboard`, and Tailscale Serve proxies HTTPS to `127.0.0.1:3000`. The README retains Railway as an optional path.

## 5. Decisions log (append-only)
- 2026-11-26: V2 supersedes the v1 visual scope: owner's team only in UI and defaults; keep covered-team model regression coverage explicit. No new thresholds, source syncs or coaching storage in Phase 1. The queue template and greeting name remain only in ignored local config.
- 2026-11-26: Bundle Fontsource fonts; use muted small labels and darker warning tag text for contrast while keeping the supplied decorative tokens. Native dialogs provide modal focus behavior.
- 2026-11-26: Build smoke artifacts into `server/dist.test`. The installed checkout's `server/dist` is a release junction; initial test compilation touched its compiled server files, which were restored from HEAD without restarting or syncing the live app.
| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
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
- V2 Home and data features await subsequent phases. Navigation count examples appear only on `/styleguide` until live flags/coaching data exists. The queue template has not been fetched or mapped; QA remains disconnected.

- The owner approved importing the prior coaching cycle. Its MTD totals are saved under the Cairo sync date with the source cycle recorded.
| Issue | Impact | Planned fix |
|---|---|---|
| One agent's MTD lateness differs from the daily sum on the installed data | The dashboard shows the MTD total beside daily dates | Owner to check the workbook |
| `npm run build` writes through the `server/dist` junction | Would overwrite the installed app | Use `build:smoke` in this checkout |
| V2 review checkpoint | Phase 2 intentionally stopped | Owner reviews desktop and phone screenshots |
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
| Q7 | Should NCNS/AWOL be URGENT, and from how many days per cycle? | no (stays LATER) | open |
| Q8 | "Behind pace" is done < 2 × elapsed ÷ total, so everyone at 0 is behind from day 1. Is that intended, or only once a whole coaching is due? | no | open |
| Q9 | The paste has no break-exceed minutes. Is there a column with them? | no | open |
| Q10 | Does a shout-out ("clean record") mean no lateness, missing time or unplanned absence, with planned leave allowed? | Phase 3 default | open |
| Q11 | Does the Team View tab have any column the Team table lacks? Send its header row to approve new mappings. | no | open |

## 8. Review feedback
- **PR #20 design approved with five fixes:** viewport-sticky sidebar and internal nav scroll, greeting-name initials, smaller phone KPI values without sparklines, Floor phone wordmark/logout in Settings, and bottom-nav safe-area clearance. Regression coverage checks all current pages at 390px. Phases 2?8 are authorized after this gate.
- **PR #1 review (2026-11-21): request changes → fixed → approved.** Must-fix: covered-range replacement, stable D5 id, AM/PM. Should-fix: scope unmatched wide-attendance warnings to team leads, any column letter + `expectHeaders` + refuse sensitive headers, `dateOrder`. Nits: "Not on schedule" separate from Unknown; copy schema.sql into dist. All addressed in 8 commits with tests.
- **B–F review (2026-11-22): all approved.** Should-fix (done 2026-11-23): log nightly backup to `sync_log`. Nits open: see §6.
- **PR #10 review (2026-11-24): fixes ready for review.** Compare successful runs with the scheduled Cairo slot, restore first-boot All, and adopt the secure-cookie fallback for loopback Tailscale hosts. Regression tests cover manual and scheduled runs, sleep/resume, bootstrap success and failure, and Windows, VM, and public-bind login behavior.
- **Process notes from reviews:** keep one phase per PR and stop at checkpoints; never push to the fork; memory.md/CLAUDE.md belong in the repo.

## 9. Changelog (append-only, newest first)

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
