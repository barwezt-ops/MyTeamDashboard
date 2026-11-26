# Team Dashboard V2: master build prompt

You're building V2 of the team dashboard: a full redesign plus new features. Read this whole document before you start.

## 0. Before anything

1. Read `CLAUDE.md`, `memory.md` and `plan.md`. All hard rules still apply. Pay special attention to these:
   - no real data in git
   - join on code
   - whitelisted columns only
   - no invented business rules
   - fail loudly and never wipe
   - never overwrite owner-entered data
   - Africa/Cairo time
2. Save this document to the repo as `plan-v2.md`. It contains no real names or IDs; keep it that way. When `plan-v2.md` and `memory.md` disagree, `memory.md` wins on current state and decisions. If the disagreement is about scope, ask the owner.
3. The visual reference is `docs/design/home-v3.reference.html`. The owner will drop this file into the repo; it's a design mockup that uses fake data. It's written in a mockup format, so don't run it. Read it as the visual spec: exact colors, sizes, spacing and copy style. Section 3 below repeats the tokens in case the file is missing.
4. **Scope change:** V2 shows **only the owner's team**. Remove the "covered team leader" scope from the UI and config defaults. Keep the data model able to handle it, but hide it.

## 1. What this product is

This is a private operations console for one DTL (Deputy Team Leader) running a team of patient navigators. Every screen answers questions the DTL actually asks:

- **Every shift:** Who's working today? What went wrong yesterday? Who needs a conversation today? Who's off in the next 7 days?
- **Across the cycle (21st → 20th):** What's each agent's record? Who's getting worse? Who's behind on coaching? What are the quality scores doing?
- **For reporting:** EOD and client attendance numbers, MPR prep, documentation when something escalates.

Design principles:
- **Two time frames, always labelled.** Attendance and MTD data are updated by WFM once a day, *for the previous day*. Never call it "today's attendance". Home shows **yesterday's results** (attendance, MTD) next to **today's plan** (schedule, queues, leave).
- **Facts, not judgments.** Flags state what happened and the numbers behind it. Never guess at motives, health or personal life. Don't build a composite "agent score".
- **Fairness.** Same rules for every agent. The coaching fairness view exists so the owner can check he's treating everyone equally.
- **Calm by default, loud only when it matters.** Use red/urgent styling only when something crosses a flag the owner has set.

## 2. Data sources

| Source | What it gives | Status |
|---|---|---|
| Master/roster | codes, names, hire date, TL, title | exists |
| Dated schedule tab | per-day shifts, OFF, leave | exists |
| Attendance paste (Attendance / MTD / Team View tabs) | daily rows for yesterday and earlier in the cycle, MTD totals | exists (PR #19) |
| **Line/queue tab** (team sheet, tab "My Team's SHIFTS AND SCHEDULES") | per agent: Code, Name, Account, **Line** (= queue, e.g. "Inbound", "Inbound Training", "Dental"), and a weekly shift template Monday–Sunday ("3:45 PM - 12:45 AM" or "OFF") | **new** |
| **QA sheet** (link from owner, auto-updated for his team) | QA evaluation scores per agent | **new, waiting for link** |
| Coaching log, notes, follow-ups | entered by the owner in the app | **new** |

Rules for the new sources:
- **Line/queue tab:** read it the same way as the other tabs of that sheet (public CSV). Map Code, Line and Account, plus the weekday columns as the shift template. Store the line in history so changes over time are kept. Use the weekday template only as a fallback when the dated schedule has no entry for a day. The tab ID goes in `config/sources.local.json` only.
- **QA sheet:** when the owner sends the link, run `test-link` and show **headers and row count only**. Then stop. QA sheets often have call details, caller or patient info and comments. Map only: agent code, evaluation date, score (%), and evaluation type/form if there is one. Refuse every other column. Extend the refused-header check to cover patient/caller/MRN/DOB/phone/call ID/recording/comment patterns. Don't map anything until the owner approves.
- **Owner-entered data** (coaching, notes, follow-ups, discrepancy states) is never touched by sync. It's included in backups.
- **Cycle:** runs from the 21st to the 20th, configurable. Every cycle-based number uses this.

## 3. Design system (from Home v3)

The look is warm editorial: paper backgrounds, serif headlines, a forest-green ink sidebar and gold highlights. It should feel premium and calm, with personality. Build this as a real token + component layer first. Hard-coded one-off styles in screens aren't allowed.

**Fonts:** self-host them with `@fontsource` packages so it works offline, with no Google calls at runtime.
- Display: **Fraunces**, weights 400/500/600 plus italic 400. Used for page titles, panel titles, big numbers and the italic summary lines.
- UI: **Instrument Sans**, weights 400/500/600/700. Used for all body and UI text. Base size 13px, line-height 1.4.
- Data: **Geist Mono**, weights 400/500. Used for times, codes, small numbers and table figures, with tabular numerals.

**Colors (light theme, the default):**
| Token | Hex | Use |
|---|---|---|
| paper | `#F4EFE6` | app background |
| surface | `#FBF8F2` | panels |
| surface-2 | `#F1EADD` | subtle fills, secondary buttons |
| line | `#E5DBC9` | panel borders |
| line-soft | `#EEE6D8` | row dividers |
| ink | `#1F1B16` | text |
| muted | `#6B6153` | secondary text |
| faint | `#8A7E6C` | eyebrows, axis labels |
| forest | `#1E3A32` | sidebar, hero card, primary buttons |
| forest-text | `#E9E2D3` / `#B9C7BF` | text on forest |
| accent | `#2F5D50` | progress, links, focus |
| gold | `#D9A441` | brand dot, pace tick, avatar of owner |
| good / good-bg | `#2A7350` / `#E2EEE5` | present, improvements |
| warn / warn-bg | `#A55A17` / `#F6E7D6` | late, "SOON" |
| bad / bad-bg | `#9C3527` / `#F7E3DE` | missing, urgent |
| info / info-bg | `#2B4C7E` / `#E2E8F1` | leave, sick |
| shout-out card | `#F3E2BE` bg, `#3D2C10` text | recognition |

**Heatmap cells:** present `#CFE2D4` · late `#EBB98A` · missing `#D98B7D` · off `#ECE5D8` · leave/sick `#C2D0E5` · absent (NCNS/AWOL) `#9C3527` · future/scheduled: outline only. Every colored meaning also differs in lightness, and every legend has text labels.

**Avatar initials:** 2 letters, a soft background picked from a deterministic hash of the code: `#E4C9A8 #C9DFD0 #C3D0E6 #EBC3B6 #D8CFE8 #E9DDA9 #BFDAD6`, with ink text.

**Shape and space:**
- 4/8px spacing scale; 16px gaps between panels
- panel radius 16px, tiles 14px, rows 10px, pills 999px
- 1px borders, no heavy shadows

**Components to build first, with a `/styleguide` page showing each one with fake data:**
- **Panel:** surface, line border, 16px radius. Header has a Geist Mono number eyebrow ("01" in bad color), a Fraunces 19px title and an optional right-side action.
- **Eyebrow label:** 11px, weight 600, uppercase, 0.14em tracking, faint color.
- **Summary line:** Fraunces italic, 15–17px, muted. Generated from data with templates (section 5), never free-written.
- **KPI tile:** label, delta in a semantic color, Fraunces 36px value, 7-bar sparkline where the last bar uses the semantic color, and a subline.
- **Ink hero card:** forest background, giant Fraunces number, and an avatar stack.
- **Progress ring:** coaching KPI, with a gold tick showing expected pace for today.
- **Severity tag:** URGENT (solid bad, cream text) / SOON (warn-bg, warn text) / LATER (surface-2, muted).
- **Urgent strip:** solid bad background, cream text, pulsing dot (respects `prefers-reduced-motion`). Only rendered when at least one URGENT item exists.
- **Others:** status pill, avatar, heatmap cell + legend, data table (uppercase 11px faint headers, row dividers, mono numbers, sticky header), empty/loading/error states (skeletons, never a blank panel), drawer, command palette, toast, segmented control, buttons (primary forest pill, secondary surface pill, danger).

**Motion:** 150–200ms ease on hover and focus. The only looping animation is the urgent dot pulse. Don't use page-load fireworks.

**Quality bar ("not vibe-coded" checklist):**
- [ ] no default browser styles anywhere
- [ ] consistent spacing scale
- [ ] tabular numbers aligned
- [ ] no layout shift when data loads
- [ ] every panel has empty, loading and error states
- [ ] visible focus rings and full keyboard navigation
- [ ] text contrast ≥ 4.5:1
- [ ] works at 1440, 1280, 1024, 768 and 390px wide (panels wrap; tables scroll inside their panel)

## 4. Screens

### A. App shell
- **Sidebar** (forest, 216px): "Floor" wordmark with a gold dot; nav for Home, Attendance, Team, Coaching, Quality, Queues, Reports, Settings, with count badges (Home = urgent count, Coaching = coachings due); owner chip at the bottom. Collapses to icons under 1024px and becomes a bottom bar on a phone.
- **Page header:** eyebrow (date · cycle day X of N), Fraunces title, italic summary line, search (Ctrl K), primary action.
- **Freshness line** on every page, for example: "● Attendance & MTD through Wed 25 · QA synced 2h ago". Amber if a source is stale, red if a sync failed (this links to Settings).
- **Ctrl K command palette:** jump to any agent or screen, plus actions (log coaching, copy EOD).

### B. Home (match Home v3 exactly)
1. Header: "Good afternoon, {owner first name}." (the greeting follows Cairo time; the name comes from config) plus the generated summary line.
2. Urgent strip, only when needed.
3. Row 1:
   - **On the floor today** ink card: scheduled vs team size, avatar stack, off/leave counts, and short-line notes such as "Inbound B is one short" (needs a staffing baseline the owner sets per line; hide it until one is set).
   - 4 KPI tiles: late yesterday, missing time yesterday, break exceeds yesterday, QA average. Each has a delta against the cycle daily average, and against last cycle for QA.
   - **Coaching KPI ring.**
4. Row 2:
   - **01 Needs you:** sorted URGENT → SOON → LATER, each with an avatar, the facts and one action button.
   - **02 The week:** 7-day heatmap, with "Full cycle →" opening the attendance grid.
   - **03 Queues today:** per line, scheduled vs total, a bar, and agent chips showing state.
5. Row 3:
   - **04 Yesterday, in exceptions:** a table with only the agents who had something, plus Copy for EOD.
   - **05 Lateness:** 14-day team bars with an average line and a summary sentence.
   - **Worth a shout-out:** perfect attendance this cycle, with Copy shout-out.

### C. Attendance grid
- Agents down the side (sticky), every day of the cycle across the top (sticky), cells colored by status.
- Small corner marks for late and missing minutes.
- Future days show the schedule as outlines, and the "yesterday" column is marked.
- Hover shows a tooltip with that day's details (shift, login/logout, late, missing, break, raw status). Click opens a day drawer.
- Row totals: late count and minutes, missing time, absences by type, break exceeds. Column totals: present and late per day.
- Filters: line/queue, status, flagged only. Cycle switcher. Export CSV.

### D. Team table
Sortable, filterable, with column picker and density toggle, and saved views. Has a cycle selector and ▲▼ deltas against the last cycle. Columns cover everything on the Team View tab, plus line, QA, coaching x/2 and open flags. Clicking a row opens the agent profile.

### E. Agent profile
- **Header:** large avatar, name, code, line, shift pattern, hire date and tenure, HR status. New hires in their first 30/60/90 days get a badge.
- **Actions:** Log coaching · Prep coaching · Add note · MPR prep · Draft escalation.
- **Cycle scorecard** against the team average: late count and minutes, missing, absences, break exceeds, QA, deducted days.
- **Cycle calendar strip:** the same cells as the grid.
- **Trends across the last 6 cycles:** lateness, missing, QA.
- **Patterns:** facts only. For example: "late 4 of the last 5 Sundays", "missing time twice right after an OFF day", "break exceeded 3 days running".
- **Coaching timeline:** with whether each agreed next step was kept, worked out from the data where possible.
- **Notes** (private, tagged) and **discrepancy history**.

### F. Coaching hub (a key screen)
1. **Overview:** a big ring for the team, days left in the cycle, and pace (how many to do per day to finish). A grid of every agent with 0/1/2 bars. Sort by "needs it most": open flags first, then 0/2, then oldest last coaching.
2. **Prep sheet** for one agent. It pulls the facts automatically:
   - lateness dates and minutes this cycle
   - missing time
   - absences
   - break exceeds
   - QA trend
   - the last coaching and its agreed step, and whether it was kept
   - patterns

   Then it shows prompts by reason: attendance, quality, behaviour or recognition. These are question prompts for the conversation, not scripts.
3. **Log coaching form**, in the owner's documentation format:
   - date
   - agent
   - type (corrective, recognition, follow-up)
   - reason tags
   - **linked evidence** (pick the flagged incidents it covers)
   - what happened
   - what was said
   - agreed next step
   - follow-up date
   - agent acknowledged (yes/no)

   Every coaching counts toward the 2-per-cycle KPI. Saved locally, never synced or overwritten.
4. **Follow-ups:** due and overdue follow-ups appear on Home under SOON. Mark each one done, kept or not kept.
5. **History:** filterable, with **Copy as documentation** (date / what happened / what was said / agreed next step / follow-up date) and CSV export.
6. **Fairness view:** coachings and notes per agent side by side, with the corrective vs recognition split. Counts only, no judgments.

### G. Quality
Per agent: latest score, cycle average, trend and last eval date. Also a team distribution, "no evaluation in N days" (N set by the owner), and links to the profile and prep sheet. This stays as a placeholder with an empty state until the QA source is mapped.

### H. Queues
- **Board** grouped by line, showing who's scheduled today on each.
- **Coverage for the next 14 days:** scheduled count per line per day, with gaps highlighted against a staffing baseline the owner sets per line. Until a baseline is set, show the counts only.
- **Leave calendar.**
- **Line changes feed.**

### I. Reports
- **Copy EOD / client attendance table:** the layout is a template the owner pastes into Settings once, with placeholders filled from the data.
- **Cycle summary** for the TL.
- **MPR prep** per agent.
- **Roster changes:** new hires, leavers, dropped.

Everything is copy-to-clipboard plus CSV.

### J. Settings
Sources and sync status (with Sync now), thresholds, cycle start day, attendance read hours, staffing baselines per line, report templates, status map, and theme. Every threshold shows "set by owner" or "not set".

## 5. Flags, severity and generated text

- **URGENT** means a threshold the owner has set was crossed. The only one set today is **3 or more lateness incidents in the current cycle**. Every other threshold ships **empty** and is configurable in Settings: missing time per cycle, missing-time days in the last N, consecutive break-exceeds, QA below X, no QA eval in N days.
- **Ask the owner** before treating NCNS/AWOL as urgent. Don't decide that yourself.
- **SOON:** follow-ups due today or overdue, and coaching behind pace. Expected-by-today = 2 × elapsed cycle days ÷ total cycle days, per agent; this comes from the owner's KPI.
- **LATER:** factual patterns and informational items.
- **Dismissing:** a flag can be dismissed with a reason. That's stored as owner data and the flag comes back only if new facts arrive.
- **Generated sentences** (summary lines, captions, prep facts) come from tested templates using real numbers. Examples: "Two people need you before the 4 o'clock rush. Everyone else is on track." / "Climbing this week. Worst day was yesterday, 62 minutes." / "Five people haven't missed a minute all cycle." They must never mention health, motives or personal life, and never use an LLM at runtime.

## 6. Phases

Each phase gets its own branch and PR, stacked on the previous phase's branch. Every phase includes its tests (unit + Playwright with fake fixture data + a screenshot of each new screen at 1440 and 390 wide), passes the full quality gate and updates `memory.md`. Never merge your own PRs.

1. **Design system + app shell.** Tokens, fonts, every component on `/styleguide`, sidebar, page header, freshness line, Ctrl K. **STOP after this phase** for design review with screenshots. Don't continue until the owner approves the look.
2. **Data layer.** Line/queue source, QA source scaffolding (stop at headers when the link arrives), coaching/notes/follow-up tables and API, flags engine with thresholds config, cycle utilities, templates engine for generated text.
3. **Home**, matching Home v3.
4. **Attendance grid + Team table.**
5. **Agent profile.**
6. **Coaching hub**: prep, log, follow-ups, history, fairness.
7. **Quality + Queues.**
8. **Reports + Settings + phone layout + final polish** against the quality-bar checklist.

After phase 1 is approved, carry on through phases 2–8 without waiting. Stop early only if you're blocked, a scope question comes up, or a hard rule would be at risk. At the end, report one line per phase with its PR link, screenshots, test counts and open questions.

## 7. Privacy reminders

- Fixtures and the styleguide use fake names only (like the mockup). Real names, codes and sheet IDs stay in gitignored config and the local database.
- No patient data, ever. If any header from any source looks like patient or caller data, stop and report it.
- Coaching notes and private notes are sensitive. They're stored locally, included in backups, never logged and never exported unless the owner asks.
