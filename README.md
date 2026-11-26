# Team Dashboard

A password-protected dashboard for team schedules, roster changes, attendance and discrepancies. Sources can use public CSV, the read-only Google Sheets API, or local CSV files. SQLite stores team history and notes.

## Run on your Windows PC

The dashboard and its SQLite database run on your PC without a cloud account or payment card.

1. Install [Node.js 20 for Windows x64](https://nodejs.org/download/release/latest-v20.x/) (choose the `x64.msi` installer) and [Git for Windows](https://git-scm.com/install/windows). Node 20 is the former LTS release this project uses. Its support has ended. Open Command Prompt after installing and check that `node -v` starts with `v20.` and `node -p process.arch` prints `x64`. [Node.js support dates](https://nodejs.org/en/about/previous-releases)
2. In Command Prompt, clone the dashboard and install the dependencies needed for setup.

   ```cmd
   cd /d "%LOCALAPPDATA%"
   git clone https://github.com/barwezt-ops/MyTeamDashboard.git TeamDashboard-code
   cd TeamDashboard-code
   npm.cmd ci
   copy .env.example .env
   npm.cmd run hash-password
   node -p "require('node:crypto').randomBytes(48).toString('base64url')"
   notepad.exe .env
   ```

   At the password prompt, type the password you want to use in the dashboard and press Enter. The command may show your input on screen. Put the bcrypt hash after `DASHBOARD_PASSWORD_HASH=` and the separate random string after `SESSION_SECRET=`. Set `SOURCE_MODE=live`, leave `DATA_DIR=` blank, and keep `PORT=3000`. Save the file and keep it private.

3. Copy the sample config into the gitignored live config file, then open the copy.

   ```cmd
   copy config\sources.json config\sources.local.json
   notepad.exe config\sources.local.json
   ```

   Fill in your exact roster name and any covered leads, the master and schedule sheet IDs and numeric tab GIDs, and the column mappings. Set `sources.master.expectHeaders` to the real header text, and set the schedule anchor to the first date column and its Cairo date. Leave attendance disabled until you have mapped it. See [Connect or replace a sheet](#connect-or-replace-a-sheet) and the [example live JSON](#3-prepare-the-live-config-with-attendance-off).

   You can also keep the config alongside the data folder. Move the file to `%LOCALAPPDATA%\TeamDashboard\sources.local.json`, then set `DASHBOARD_CONFIG_FILE` in `.env` to its full path. Run `echo %LOCALAPPDATA%\TeamDashboard\sources.local.json` to display the path to paste.

4. Check both sheet links, replacing the placeholder in each command with the actual Google Sheets tab URL. Fix any reported mapping errors before continuing.

   ```cmd
   npm.cmd run test-link -- "<master tab URL>" --source=master
   npm.cmd run test-link -- "<schedule tab URL>" --source=schedule
   ```

5. Run the installer as the Windows user who will use the dashboard. It builds the app and registers the hidden **Team Dashboard** task for the current user. The app starts now and at your next Windows sign-in. Task Scheduler retries failed starts up to three times, one minute apart.

   ```cmd
   deploy\windows\install.cmd
   ```

   If PowerShell scripts are blocked, use the `.cmd` scripts. The `.ps1` scripts remain available on PCs that allow them. Keep using the same script family for maintenance.

   If Task Scheduler is unavailable or requires administrator rights, the installer uses a shortcut in your Windows Startup folder (`shell:startup`). The shortcut starts the dashboard at sign-in and has no automatic restart. If Windows Script Host or the Startup folder is blocked, the installer stops and identifies the failed step.

6. Open `http://localhost:3000` and sign in with the dashboard password. The first live start syncs all sources if the dashboard has no successful roster sync. Once the dashboard is idle, open **Settings → Sync now → All** and check **Sync log** for successful roster, schedule, and rules entries.

### Maintain your Windows dashboard

- **Update.** In the checkout folder, run `deploy\windows\update.cmd`. It pulls with `--ff-only` and builds in a separate folder while the current version runs. It verifies health after starting the new build and restores the previous build if the health check fails.
- **Check status.** Run `deploy\windows\status.cmd` for the startup entry, health response, data path, and last 20 log lines. The dashboard keeps three log files of up to 5 MB each under `data\logs`.
- **Find and protect your data.** In File Explorer, enter `%LOCALAPPDATA%\TeamDashboard\data` to find `dashboard.db`, `backups` and `logs`. Keep `DATA_DIR` outside the checkout and outside OneDrive. Each week, use **Settings → Download backup** and keep a private copy outside the PC, for example on a USB drive. See [Back up and restore dashboard data](#back-up-and-restore-dashboard-data) for what the downloaded file contains.
- **When the PC is off or asleep.** The dashboard runs while the PC is awake and your Windows account is signed in. On start and every 15 minutes, it checks the latest scheduled daily sync and today's backup using Cairo time. A manual sync before the scheduled time leaves that scheduled run due. Today's backup is due after 02:00. After a failure the dashboard waits at least an hour before retrying automatically. Check **Settings → Sync log** or the sync badge for failures.
- **Stop and restart.** For a scheduled task, run `schtasks /End /TN "Team Dashboard"` to stop and `schtasks /Run /TN "Team Dashboard"` to start. For a Startup shortcut, sign out to stop and sign back in to start.
- **Uninstall.** Run `deploy\windows\uninstall.cmd`. It stops the dashboard, removes its scheduled task or Startup shortcut, and leaves the data in place.
- **SQLite installation troubleshooting.** The locked `better-sqlite3` version provides a Windows x64 prebuilt binary for Node 20. If npm tries to run `node-gyp` or asks for Visual Studio, recheck `node -v` and `node -p process.arch`, clear any `npm_config_build_from_source` override, and make sure GitHub release downloads are reachable. Rerun `npm.cmd ci` after fixing the issue. If your network blocks the prebuilt download and you must build from source, install Python 3 and Visual Studio 2022 Build Tools with **Desktop development with C++**, then rerun the command. [SQLite prebuilt binaries](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.9.0) · [node-gyp Windows requirements](https://github.com/nodejs/node-gyp#on-windows)

### Optional phone access with Tailscale

1. Install Tailscale on Windows and on your phone. Sign both in to the same tailnet, and use a tailnet approved for your work if applicable. [Windows setup](https://tailscale.com/docs/install/windows) · [Tailscale downloads](https://tailscale.com/download)
2. On the PC, open PowerShell as Administrator and run the following command. If Tailscale prompts you to enable HTTPS, follow its link and rerun the command. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)

   ```powershell
   tailscale serve --bg --https=443 http://127.0.0.1:3000
   ```

3. Connect Tailscale on your phone and open the full `https://<pc-name>.<tailnet-name>.ts.net` URL printed by Serve or `tailscale serve status`. Use HTTPS for sign-in because the phone session cookie requires it. Sign in once from your phone and confirm the dashboard loads. Keep the PC on, awake, and signed in while using the dashboard.

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
2. Copy `config/sources.json` to the gitignored `config/sources.local.json` for a local live run. On a deployed service, set `DASHBOARD_SOURCE_CONFIG` to the full JSON. Set the configured identity, IDs, GIDs and mappings. Set `dateOrder` to `DMY` for slash dates in day/month/year order. The default is `MDY`. Sheet access must be read-only and work without signing in.
3. Keep schedule on CSV export. Set `sources.schedule.anchor.column` and `sources.schedule.anchor.date` to the first date column and its Cairo date, and retain a matching `stopAtHeader`. Check the latest sync for `ANCHOR_MISMATCH`.
4. Confirm attendance column meanings and verify its CSV export before enabling it. A nonempty value from the long layout’s configured `missing` column creates a D4 finding. The parser also supports a wide layout with date columns and no separate Missing field.
5. Restart or redeploy and run **Sync now → All** in Settings. Check that the job results remain healthy and spot-check the dates against the sheet.

The roster sync runs Sundays at 12:00 Cairo. The daily schedule, attendance and discrepancy sync runs at 16:00 Cairo. The app refreshes the roster first when its last successful sync is more than seven days old.

## Free VM deploy (optional, needs a card)

### 1. Create the project and budget

1. In Google Cloud Console, create a project for the dashboard and link a Cloud Billing account. Open **Billing → Budgets & alerts → Create budget**, scope it to this project, set a monthly amount of **$1**, and enable email alerts at 50% and 100% of actual spend. Alerts notify you about charges. They do not automatically stop spending.
2. Confirm you have a Tailscale network (tailnet) approved for this use before you deploy. The free Personal plan is for non-commercial use. For a work dashboard, check whether your organization already provides an eligible tailnet before relying on a $0 setup. [Google Cloud budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets) · [Tailscale plans](https://tailscale.com/pricing)

### 2. Create the VM and connect from your browser

1. In **VPC network → VPC networks**, create a **Custom** network with one subnet in `us-central1`, `us-east1`, or `us-west1`. Give the subnet an unused private IPv4 range, such as `10.10.0.0/24`. Select **IPv4 and IPv6 (dual stack)** and **External** for IPv6 access.
2. In **VPC network → Firewall**, add an ingress rule for TCP port 22 from `35.235.240.0/20` on that network. Use the target tag `dashboard-ssh` so it applies only to this VM. Give your Google account the IAP tunnel and VM login permissions in the linked guide.
3. In **Compute Engine → VM instances → Create instance**, name the VM `team-dashboard`. Pick a zone in the subnet's region, **E2 → e2-micro** with Standard provisioning, and a **30 GB Standard persistent disk** with **Ubuntu 24.04 LTS x86/64**. Under **Networking**, use the new subnet and the `dashboard-ssh` tag. Select dual stack, **External IPv4 → None**, and **External IPv6 → Ephemeral (Automatic)**. Leave the HTTP and HTTPS firewall boxes unchecked.
4. Open the VM in **Compute Engine → VM instances**, click **Edit**, expand its network interface, and change **External IPv4** to **Ephemeral**. Save the change. GitHub requires IPv4, so attach this address before downloading setup. Keep it attached until Tailscale is installed and configured.
5. Open **Cloud Shell** from the console header and run the following in the browser, replacing the example zone with the VM's actual zone.

   ```sh
   gcloud compute ssh team-dashboard --zone=us-central1-a --tunnel-through-iap
   ```

The Free Tier covers one eligible e2-micro, 30 GB-months of standard disk, and up to 1 GB of eligible monthly outbound traffic from North America. External IPv6 addresses have no address fee. The billing account gets one eligible external IPv4 hour per month across setup and updates, then pays about $0.005 per hour, including for ephemeral addresses. Keep external IPv4 unset for normal operation and skip Cloud NAT. [Free Tier limits](https://docs.cloud.google.com/free/docs/free-cloud-features#compute) · [Network pricing](https://cloud.google.com/vpc/network-pricing#ipaddress) · [Dual-stack VPC setup](https://docs.cloud.google.com/vpc/docs/create-modify-vpc-networks) · [SSH through IAP](https://docs.cloud.google.com/compute/docs/connect/ssh-using-iap)

### 3. Install and configure the dashboard

After the deployment PR is merged into `main` and the ephemeral IPv4 address is attached, paste the following into the VM's SSH terminal. Setup installs Node 20, adds 2 GB of swap, builds the app, creates its data directory, and enables the service and Ubuntu's unattended security updates.

```sh
curl -4fsSLo setup.sh https://raw.githubusercontent.com/barwezt-ops/MyTeamDashboard/main/deploy/setup.sh
sudo bash setup.sh
```

Generate the hash and session secret from the built release. Type your chosen password at the first prompt. Save that password privately for login.

```sh
cd /opt/team-dashboard-current
npm run hash-password
node -p "require('node:crypto').randomBytes(48).toString('base64url')"
sudoedit /etc/team-dashboard.env
```

In the editor, enter one `NAME=value` line for each variable and save the file. Setup creates it with root ownership and mode 600.

| Variable                  | What to enter                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | `3000`, the dashboard port Tailscale Serve forwards to.                                                                                      |
| `BIND_HOST`               | `127.0.0.1`, so only programs on the VM can reach the Node server directly. The systemd unit also enforces this address.                     |
| `DATA_DIR`                | `/var/lib/team-dashboard`, where SQLite and backup files are stored.                                                                         |
| `SOURCE_MODE`             | `live`, to read the configured sheets and use secure login cookies.                                                                          |
| `TZ`                      | `Africa/Cairo`, the timezone used for dashboard operations.                                                                                  |
| `DASHBOARD_PASSWORD_HASH` | Paste the bcrypt hash printed by `npm run hash-password`. Put single quotes around the hash.                                                 |
| `SESSION_SECRET`          | Paste the random string printed by the Node command. It signs login sessions.                                                                |
| `DASHBOARD_SOURCE_CONFIG` | Paste the full live JSON in single quotes, using the instructions below. It contains the team filter, sheet mappings, and schedule settings. |

Use the [attendance-off live JSON example](#3-prepare-the-live-config-with-attendance-off). Fill in your actual master and schedule details privately. Run `test-link` on the real master first, verify the mapped headers, and set `dateOrder` from the sample date. Check the schedule link and anchor too. Keep `sources.attendance.enabled` set to `false`.

To get a one-line value, save your edited JSON on the VM with `umask 077; nano ~/dashboard-sources.json`. Run the command below and paste its output after `DASHBOARD_SOURCE_CONFIG=` in the environment file. It encodes apostrophes inside names so the surrounding single quotes still work.

```sh
node -e 'const q = String.fromCharCode(39); const config = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log(q + JSON.stringify(config).replaceAll(q, "\\u0027") + q)' "$HOME/dashboard-sources.json"
sudoedit /etc/team-dashboard.env
sudo systemctl start team-dashboard
curl -fsS http://127.0.0.1:3000/api/health
```

### 4. Open the dashboard over private HTTPS

1. On the VM, run the commands below to install and start Tailscale. Open the sign-in link it prints and approve the VM in your tailnet. Install Tailscale on your phone or laptop and sign in to the same tailnet. Check that MagicDNS and HTTPS certificates are enabled in the tailnet's DNS settings. [Linux install](https://tailscale.com/docs/install/linux) · [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

   ```sh
   curl -fsSLo tailscale-install.sh https://tailscale.com/install.sh
   sh tailscale-install.sh
   sudo tailscale up
   ```

2. Run `sudo tailscale serve --bg --https=443 http://127.0.0.1:3000`. If prompted, follow the link to enable HTTPS, then rerun the command. With Tailscale connected on your phone or laptop, open the `https://<name>.ts.net` URL shown by `sudo tailscale serve status`. Use Serve to keep access inside your tailnet. Leave Funnel and public web firewall rules off. [Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve)
3. Return to the VM's network interface in Google Cloud Console, set **External IPv4 → None**, and save. Reconnect through Cloud Shell if your SSH session closed. Run `sudo apt-get update --error-on=any` to confirm every configured package repository can refresh over IPv6. If the refresh fails, apply security updates during each IPv4 maintenance window using the command in the next section. [Ubuntu automatic updates](https://documentation.ubuntu.com/server/how-to/software/automatic-updates/)
4. Open the Tailscale HTTPS URL and sign in with the password you chose. Open **Settings → Sync now → All** once the dashboard is idle. In **Sync log**, check that `roster`, `schedule`, and `rules` succeeded, and read any warnings in **Details**. This verifies that the sheets still work over IPv6.
5. The next day after 16:00 Cairo, check **Settings → Sync log** for a successful 02:00 `backup` and successful `schedule` and `rules` rows around 16:00. Review the billing report once usage is posted.

### 5. Maintain the VM

> **Every dashboard update requires a temporary IPv4 address.**
>
> 1. In Google Cloud Console, edit the VM's network interface and set **External IPv4 → Ephemeral**. Save the change and SSH in through IAP.
> 2. Run `sudo bash /opt/team-dashboard/deploy/update.sh`. It pulls and builds separately before restarting, so a failed build leaves the running release available. If APT could not refresh over IPv6, apply security updates during this window with `sudo apt-get update && sudo apt-get -y upgrade`.
> 3. Set **External IPv4 → None** and save, even if the update failed. Check the dashboard through Tailscale.

- **View logs.** Run `sudo journalctl -u team-dashboard -n 100 --no-pager` for recent messages or `sudo journalctl -u team-dashboard -f` for live logs. Press Ctrl+C to exit live logs.
- **Restart.** Run `sudo systemctl restart team-dashboard`. Check `sudo systemctl status team-dashboard --no-pager`.
- **Rotate the password.** In `/opt/team-dashboard-current`, run `npm run hash-password`. Use `sudoedit /etc/team-dashboard.env` to replace `DASHBOARD_PASSWORD_HASH`, then restart and sign in with the new password. Changing the hash invalidates existing sessions.
- **Keep a weekly backup off the VM.** Every week, use **Settings → Download backup** and keep the downloaded file in private storage outside the VM. The VM stores nightly JSON backups in `/var/lib/team-dashboard/backups` and the SQLite file at `/var/lib/team-dashboard/dashboard.db`.

## Railway (optional, needs a card)

This setup is retained for anyone who already uses Railway. The owner's setup runs on their Windows PC.

### 1. Create the project and attach storage

After the Phase 7 PR is merged, choose **New Project → GitHub Repo** in Railway and select `barwezt-ops/MyTeamDashboard`. Choose **Add Variables** to stage the service before its first deploy. Use the `main` branch and keep the repository root as the service root. Use one service with one replica. Leave **Serverless** off so the scheduled jobs can run even when nobody is signed in.

Right-click the project canvas, choose **Attach Volume**, select the dashboard service, and set the mount path to `/data`. This volume holds the SQLite database and nightly backups. Keep it attached when redeploying or rolling back. [Railway quick start](https://docs.railway.com/quick-start) · [Volumes](https://docs.railway.com/volumes)

### 2. Set the service variables

Open the dashboard service's **Variables** tab and add the entries below. Run `npm ci` from the repository folder with Node 20 before generating the password hash or checking sheet links.

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
3. In dashboard **Settings**, click **Sync now → All** once the dashboard is idle. In **Sync log**, confirm `roster`, `schedule`, and `rules` succeeded. Read **Details** for warnings or errors and check the source cards for more context. For example, correct the master mapping if you see `COLUMN_HEADER_MISMATCH` or check the schedule's first date column and anchor if you see `ANCHOR_MISMATCH`. Run **All** again after applying a correction. Spot-check the Roster and Today views against the source tabs.
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
3. In your local live config, fill `headerRows` and choose `access`. Public Google Sheets use `public` by default and need `sheetId` and `gid`. For restricted sheets or local CSV, follow the setup below. Keep `enabled: false` and sync roster and schedule before the dry run.
4. Select **Dry-run attendance** in Settings, or run `npm run sync -- --job=attendance --dry-run` with the existing dashboard's `DATA_DIR`. Review source rows, team matches, records and dates that would be stored, sample statuses, and projected D1–D4 counts. Long sheets identify rows by code and cannot distinguish an unrecognized team code from a non-team code. A wide sheet can count unmatched rows under a configured team lead.
5. Enable attendance only after the mappings and sample results agree with the source. Validate the dashboard against the sheet for five working days as part of Phase 6 acceptance.

### Connect a restricted sheet with Google sign-in

1. On the PC that runs the dashboard, open Google Cloud Console using the work account that can view the attendance tab. Create the project **team-dashboard** without billing or paid services. Enable only the **Google Sheets API**.
2. In Google Auth Platform, set **Team Dashboard** as the app name and use the owner's work email for support. Choose **Internal** if available. Otherwise choose **External**, then **Publish to production**. External Testing grants for this scope expire after seven days. Add only `https://www.googleapis.com/auth/spreadsheets.readonly` under Data Access.
3. Create a **Desktop app** OAuth client. Put its client ID and secret directly into the local `.env` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Keep the credentials and token private. Run `npm run google-login` as the Windows user who runs the dashboard. Complete the browser prompts with the work account and review any unverified-app warning. If Google reports an organization administrator block, stop and use the CSV workflow below.
4. The app saves its refresh token in `DATA_DIR/google-token.json` with owner-only permissions. Run `npm run google-login` again when prompted after expiry or revocation. Run `npm run google-logout` to revoke the grant and delete the local token. Apply changes to the running installation's `.env` and launch it again to load the client settings.
5. In the browser, inspect the tab title, header row and candidate column letters. Stop if any column looks like patient data. Put the exact `sheetId`, tab `gid`, case-sensitive tab name (`tab`), `access: "google"` and candidate mappings in the private config, with attendance disabled. Google needs an explicit `wide.lastDateColumn` for wide attendance. If configuring a Google schedule, set `stopColumn` to the existing stop header column. The app reads mapped columns by letter and maps them back to their original positions.
6. Run `npm run test-link -- '<view-link>' --source=attendance --access=google` or use **Check a link** with the Attendance mapping and Google sign-in. Check the mapped headers, row count and sample date. Confirm what counts as missing attendance with the owner before finalizing the mapping. A Google check accepts the configured source and its exact tab link.
7. Run the attendance dry run and review its record and flag counts. After the owner approves, set `enabled: true`, restart the running app, and select **Settings → Sync now → All**.

[Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app) · [App audience and publishing](https://support.google.com/cloud/answer/15549945) · [Sheets display values](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)

### Download attendance through your signed-in browser

1. Keep attendance disabled while testing. Set `sources.attendance.access` to `"browser"` and configure the existing `sheetId`, `gid`, and column mapping in `config/sources.local.json`. For long attendance, `expectHeaders` can pin exact header text by field.
2. Run `npm run browser-login` from the checkout. Chrome opens directly with a dedicated owner-only profile at `DATA_DIR/browser-profile`. Sign in to your work Google account by hand and close the browser window. Keep credentials in your normal sign-in flow. The dashboard uses the session in that profile for the CSV download.
3. Run **Settings → Dry-run attendance** and verify the mapping. After approval, set `enabled: true` and restart. Use **Settings → Sync now → Attendance** or **All** to sync on demand. The scheduled attendance sync checks once per working hour in Cairo time. If Google blocks the automated download, scheduled attendance pauses until a manual run succeeds.
4. When WFM shares a new tab, paste its tab-specific view link into **Settings → Attendance sheet** and save. The field updates the local private config while sync is idle.

The optional `sources.attendance.browser` settings are `channel` (installed `chrome` by default, or `msedge`), `executablePath` (absolute path to an installed browser), `timeoutMs` (default 600000), `startHour` (default 9), and `endHour` (default 18, exclusive). The app closes the browser and removes the raw download after each attempt. Successful syncs retain only a filtered team archive.

### Drop or upload an attendance CSV

Set `sources.attendance.access` to `"file"` and verify the column mapping against the export. Once the roster has synced, use a UTF-8 CSV up to 150 MB directly from **File → Download → Comma-separated values (.csv)**. Leave the original column order intact. Stop if any header suggests patient data.

Use **Settings → Upload attendance CSV** to stream the file and save only the team's mapped cells to the inbox. You can also drop the export into `%LOCALAPPDATA%\TeamDashboard\inbox\attendance\`. The daily job and catch-up read the latest file by modification time. After a successful import, the app saves a filtered copy in `processed` and removes the inbox file. It keeps 14 processed files and can reuse the latest one. A rejected drop remains in the inbox for correction. A dry run reads the input without consuming the drop.
