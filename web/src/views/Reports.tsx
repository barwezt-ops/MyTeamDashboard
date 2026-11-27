import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type {
  attendanceEmail,
  cycleSummary,
  eodReport,
  rosterReport,
} from "../../../server/src/v2/reports";
import type { ProfileView } from "../../../server/src/v2/profile";
import { mprText } from "../../../server/src/v2/documents";
import { shortDate } from "../../../server/src/v2/templates";
import { DataTable, Empty, ErrorNotice, Section } from "../components/ui";
import { useHead, useView } from "../v2/context";
import {
  copy,
  downloadCsv,
  tableHtml,
  tableText,
  type Table,
} from "../v2/copy";
import { DocumentDialog } from "../v2/dialogs";
import { CycleSelect, LoadError, Skeleton, useCopy } from "../v2/parts";

export type ReportsData = {
  today: string;
  cycle: { from: string; to: string };
  cycles: { from: string; to: string }[];
  eod: ReturnType<typeof eodReport>;
  email: ReturnType<typeof attendanceEmail>;
  summary: ReturnType<typeof cycleSummary>;
  roster: ReturnType<typeof rosterReport>;
  agents: { code: string; name: string }[];
};

/** Copies the owner's layout, as a table when it has columns. */
export const copyReport = (report: { text: string; table: Table | null }) =>
  copy(report.text, report.table ? tableHtml(report.table) : undefined);

const lines = (text: string): Table => ({
  headers: ["Report"],
  rows: text.split("\n").map((line) => [line]),
});

function ReportTable({ table, label }: { table: Table; label: string }) {
  return (
    <DataTable label={label}>
      <thead>
        <tr>
          {table.headers.map((header, i) => (
            <th key={i}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.map((value, j) => (
              <td key={j} className="nowrap">
                {value || "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function Actions({
  onCopy,
  onCsv,
  name,
  disabled = false,
}: {
  onCopy: () => Promise<void>;
  onCsv: () => void;
  name: string;
  disabled?: boolean;
}) {
  const run = useCopy();
  return (
    <div className="button-row">
      <button
        type="button"
        className="primary small"
        disabled={disabled}
        onClick={() => run(onCopy, name + " copied.")}
      >
        Copy {name}
      </button>
      <button
        type="button"
        className="secondary small"
        aria-label={`Export ${name} as CSV`}
        disabled={disabled}
        onClick={onCsv}
      >
        Export CSV
      </button>
    </div>
  );
}

function Email({ email }: { email: ReportsData["email"] }) {
  const run = useCopy();
  const { table, subject, needsAccount, date } = email;
  return (
    <Section
      title="Attendance email"
      number="02"
      action={
        <Actions
          name="email table"
          disabled={!table.rows.length}
          onCopy={() => copy(tableText(table), tableHtml(table))}
          onCsv={() => downloadCsv(`attendance-email-${date}.csv`, table)}
        />
      }
    >
      <div className="panel-body">
        <div className="subject-line">
          <span className="eyebrow">Subject</span>
          <code>{subject}</code>
          <button
            type="button"
            className="secondary small"
            disabled={needsAccount}
            onClick={() => run(() => copy(subject), "Subject copied.")}
          >
            Copy subject
          </button>
        </div>
        {needsAccount && (
          <p className="notice-line">
            Set the account in{" "}
            <Link className="panel-link" to="/settings#email-layout">
              Settings
            </Link>{" "}
            to finish the subject.
          </p>
        )}
      </div>
      {table.rows.length ? (
        <ReportTable table={table} label="Attendance email table" />
      ) : (
        <Empty>No missing time recorded on {shortDate(date)}.</Empty>
      )}
    </Section>
  );
}

function MprActions({ code, cycle }: { code: string; cycle: string }) {
  const [open, setOpen] = useState(false);
  const result = useView<ProfileView>(
    `/v2/agents/${encodeURIComponent(code)}?cycle=${cycle}`,
  );
  const profile = result.data;
  return (
    <>
      <button
        type="button"
        className="primary small"
        disabled={!profile}
        onClick={() => setOpen(true)}
      >
        Open MPR prep
      </button>
      <button
        type="button"
        className="secondary small"
        aria-label="Export MPR scorecard as CSV"
        disabled={!profile}
        onClick={() =>
          downloadCsv(`mpr-${code}-${cycle}.csv`, {
            headers: ["Measure", "Agent", "Team average"],
            rows: profile!.scorecard.map((row) => [
              row.label,
              row.value,
              row.team,
            ]),
          })
        }
      >
        Export CSV
      </button>
      {result.error && (
        <ErrorNotice retry={result.reload}>{result.error}</ErrorNotice>
      )}
      {open && profile && (
        <DocumentDialog
          title="MPR prep"
          text={(notes) => mprText(profile, notes)}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Mpr({ data }: { data: ReportsData }) {
  const [code, setCode] = useState("");
  return (
    <Section title="MPR prep" number="04">
      <div className="panel-body">
        <div className="toolbar">
          <label>
            <span>Agent</span>
            <select
              aria-label="Agent"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            >
              <option value="">Choose an agent</option>
              {data.agents.map((agent) => (
                <option key={agent.code} value={agent.code}>
                  {agent.name} · {agent.code}
                </option>
              ))}
            </select>
          </label>
          {code ? (
            <MprActions key={code} code={code} cycle={data.cycle.from} />
          ) : (
            <p className="quiet">
              Choose an agent to prepare their cycle facts and history.
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}

export function Reports() {
  const [cycle, setCycle] = useState("");
  const [date, setDate] = useState("");
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  else if (cycle) params.set("cycle", cycle);
  const result = useView<ReportsData>(
    "/v2/reports" + (params.size ? "?" + params : ""),
  );
  const view = result.data;
  const { hash } = useLocation();
  const loaded = !!view;
  useEffect(() => {
    if (loaded && hash) document.querySelector(hash)?.scrollIntoView();
  }, [loaded, hash]);
  useHead("Reports", "Copy it or take it as a CSV. Nothing is sent anywhere.");
  if (!view)
    return result.error ? (
      <LoadError title="Reports" error={result.error} retry={result.reload} />
    ) : (
      <Skeleton className="screen-size" label="reports" />
    );
  const { eod, summary, roster } = view;
  return (
    <>
      <div className="toolbar">
        <CycleSelect
          cycles={view.cycles}
          value={view.cycle.from}
          onChange={(from) => {
            setDate("");
            setCycle(from);
          }}
        />
      </div>
      <Section
        title="End of day and client attendance"
        number="01"
        action={
          <Actions
            name="report"
            disabled={!eod.text}
            onCopy={() => copyReport(eod)}
            onCsv={() =>
              downloadCsv(
                `attendance-${eod.date}.csv`,
                eod.table ?? lines(eod.text),
              )
            }
          />
        }
      >
        <div className="panel-body">
          <div className="toolbar">
            <label>
              <span>Report date</span>
              <input
                type="date"
                max={view.today}
                value={eod.date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <span className="toolbar-end">
              <span className="panel-note">
                {eod.customTemplate ? "Your layout" : "Default layout"}
              </span>
              <Link className="panel-link" to="/settings#report-template">
                Edit layout →
              </Link>
            </span>
          </div>
          {!eod.reported && (
            <p className="notice-line">
              No attendance is reported for {shortDate(eod.date)}.
            </p>
          )}
          {!!eod.unknown.length && (
            <ErrorNotice>
              Unknown placeholders in your layout: {eod.unknown.join(", ")}
            </ErrorNotice>
          )}
        </div>
        {eod.table ? (
          eod.table.rows.length ? (
            <ReportTable table={eod.table} label="End of day report" />
          ) : (
            <Empty>No rows for this date.</Empty>
          )
        ) : eod.text ? (
          <pre className="report-text" tabIndex={0}>
            {eod.text}
          </pre>
        ) : (
          <Empty>No rows for this date.</Empty>
        )}
      </Section>
      <Email email={view.email} />
      <Section
        title="Cycle summary"
        number="03"
        action={
          <Actions
            name="summary"
            onCopy={() =>
              copy(
                summary.text + "\n\n" + tableText(summary.table),
                `<p>${summary.text
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/\n/g, "<br>")}</p>` + tableHtml(summary.table),
              )
            }
            onCsv={() =>
              downloadCsv(`cycle-summary-${view.cycle.from}.csv`, summary.table)
            }
          />
        }
      >
        <pre className="report-text" tabIndex={0}>
          {summary.text}
        </pre>
        {summary.table.rows.length ? (
          <ReportTable table={summary.table} label="Cycle summary by agent" />
        ) : (
          <Empty>No active agents.</Empty>
        )}
      </Section>
      <Mpr key={view.cycle.from} data={view} />
      <div id="roster-changes" />
      <Section
        title="Roster changes"
        number="05"
        action={
          <Actions
            name="roster changes"
            disabled={!roster.rows.length}
            onCopy={() => copy(tableText(roster), tableHtml(roster))}
            onCsv={() =>
              downloadCsv(`roster-changes-${view.cycle.from}.csv`, roster)
            }
          />
        }
      >
        {roster.rows.length ? (
          <ReportTable table={roster} label="Roster changes" />
        ) : (
          <Empty>No new hires, leavers or moves in this cycle.</Empty>
        )}
      </Section>
    </>
  );
}
