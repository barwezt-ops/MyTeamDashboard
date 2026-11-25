# CLAUDE.md — Team Dashboard

You are working on a private-use team dashboard: a Node/Express + SQLite service that reads configured sources on a schedule, keeps **only the owner's team**, and serves a React dashboard (Today, Discrepancies, Trends, Roster, Agent profiles, Settings).

## Start of every task

1. **Read `memory.md` in full.** It is the source of truth for current state, decisions, open questions and history.
2. Read the relevant parts of `plan.md` (the original v1 spec). If `plan.md` and `memory.md` disagree, `memory.md` wins for _state and decisions_; ask the owner if it's about _scope_.
3. Run `npm ci` if `node_modules` is missing. Node 20 (`.nvmrc`).

## End of every task

- Update `memory.md` before reporting back: Snapshot, Features, Decisions (with the why), Known issues, Changelog. A task isn't done until memory.md is updated.
- Snapshot sections are edited in place; the Decisions log and Changelog are append-only.

## Repo and workflow

- **The only repo is `barwezt-ops/MyTeamDashboard`. It is public, and that is final.** Never push to the `travis-holt/MyTeamDashboard` fork.
- One phase / workstream = one branch = one PR. Never push to `main` directly, never merge your own PR, never force-push shared branches.
- Small focused commits; every fix and feature ships with its test in the same PR.
- Stop at plan checkpoints and hand back for review.

## Commands

| What                                            | Command                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Dev (server :3000 + Vite, proxies `/api`)       | `npm run dev`                                                                                 |
| Build (server tsc + copy schema.sql, then Vite) | `npm run build`                                                                               |
| Start built server                              | `npm start`                                                                                   |
| Lint + format check                             | `npm run lint` (`npm run format` to fix)                                                      |
| Typecheck                                       | `npm run typecheck`                                                                           |
| Unit tests (Vitest)                             | `npm test` / `npm run coverage`                                                               |
| UI tests (Playwright, synthetic data)           | `npx playwright install chromium && npm run smoke`                                            |
| One-off sync                                    | `npm run sync -- --job=roster\|daily\|all` (attendance preview: `--job=attendance --dry-run`) |
| Check a sheet link                              | `npm run test-link -- '<link>' [--source=master\|schedule\|attendance]`                       |
| Backup / restore                                | `npm run backup` / `npm run restore -- <file>`                                                |
| Password hash for `.env`                        | `npm run hash-password`                                                                       |

**Quality gate before any PR:** lint, typecheck, `npm test`, `npm run build`, and Playwright all pass. CI (GitHub Actions) runs lint + typecheck + unit tests on every push.

## Hard rules (don't break these)

1. Never write to the source sheets. Sources are read-only, via public CSV export or, for sources marked access: google, the Google Sheets API with the owner's read-only sign-in. No Apps Script, no service accounts, no API keys.
2. **No real data in git, ever.** No real names, agent codes, phone numbers, emails, sheet IDs, CSVs, SQLite files, notes or env values. Fixtures are fake (`Demo Lead`, `Cover Lead`, codes `99xxx`). Real config lives in gitignored `config/sources.local.json` or the `DASHBOARD_SOURCE_CONFIG` env var.
3. **No patient data** exists in the sources and none may ever be stored.
4. **Join on agent code, never on name.** Names differ between sheets.
5. **Whitelisted columns only.** Phone, email, laptop, "American Name" columns are never read; the config refuses to map headers matching `/phone|email|laptop|american/i`.
6. **Config over code.** Sheet IDs, GIDs, column letters, schedule anchor, cron times, status labels, date order — all in config.
7. **No invented business rules.** `thresholds` ships empty; only the owner (via TL/SOP) sets numbers. Same rules for every agent, no per-agent exceptions.
8. **Fail loudly, never wipe on failure.** A failed sync logs to `sync_log`, shows on Settings/the sync badge, and leaves existing data untouched. Syncs only replace the dates the source actually covers.
9. **Never overwrite user data in sync:** discrepancy `state`/`tl_comment` and `notes` are owner-entered.
10. **Timezone is Africa/Cairo** (it observes DST). Each sync locks in one Cairo date at start.

## Where things are

- `server/src/` — `fetch/` (CSV download, link checks, SSRF-safe), `parse/` (master, schedule anchor logic, attendance long/wide, status mapping, dates), `sync/` (jobs, cron, runner), `rules/` (D1–D7), `db/` (schema.sql, repo), `api/` (routes, zod request validation, export), `backup/`, `auth.ts`, `config.ts`, `cli.ts`
- `web/src/` — `App.tsx` (layout, router, scope toggle), `views/`, `components/ui.tsx`, `theme.ts` (status colors), `api.ts`
- `fixtures/*.sample.csv` — fake test data; `fixtures/local/` is gitignored for real downloads
- `config/sources.json` — sample config (fake names, empty IDs)
- `README.md` — setup, connecting sheets, Railway deploy, backups, attendance mapping
