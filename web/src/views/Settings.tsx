import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ExternalLink, RefreshCw } from "lucide-react";
import {
  mtdMismatchWarning,
  mtdNotPasted,
  type Job,
  type SyncRun,
  type SyncStatus,
} from "../../../server/src/api/dto";
import { mtdMismatch, fullDate } from "../../../server/src/v2/templates";
import { api, message } from "../api";
import { AttendancePreview } from "./AttendancePreview";
import { Backups } from "./Backups";
import { CheckSheetLink } from "./CheckSheetLink";
import {
  DataTable,
  Empty,
  ErrorNotice,
  Loading,
  Section,
} from "../components/ui";
import { SegmentedControl } from "../components/design";
import { useHead } from "../v2/context";
import { OwnerSettings } from "./OwnerSettings";
import { StatusMap } from "./StatusMap";

function result(run: SyncRun | null | undefined) {
  if (run?.ok === true)
    return <span className="sync-badge good">Succeeded</span>;
  if (run?.ok === false) return <span className="sync-badge bad">Failed</span>;
  return (
    <span className="sync-badge waiting">{run ? "Running" : "No runs"}</span>
  );
}
/** The mismatch warning carries codes; the notice above names the agents. */
const warningText = (warning: string) =>
  warning.startsWith(mtdMismatchWarning)
    ? mtdMismatch(warning.slice(mtdMismatchWarning.length).split(",").length)
    : warning;
type ReadConfig = {
  sources?: {
    attendance?: { paste?: { startHour: number; endHour: number } };
  };
};

export function Settings({
  status,
  logout,
  dark,
  toggle,
}: {
  status: { data?: SyncStatus; error?: string; reload: () => void };
  logout: () => void;
  dark: boolean;
  toggle: () => void;
}) {
  const [request, setRequest] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const { hash } = useLocation();
  const loaded = !!status.data;
  useEffect(() => {
    if (!loaded || !hash) return;
    // The forms above the target load first, so wait for them.
    const timer = window.setTimeout(
      () => document.querySelector(hash)?.scrollIntoView(),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [hash, loaded]);
  useHead("Settings", "Thresholds, sources and your layout, in one place.");
  if (status.error)
    return <ErrorNotice retry={status.reload}>{status.error}</ErrorNotice>;
  if (!status.data) return <Loading />;
  const data = status.data;
  const qaEnabled = data.sources.some(
    (source) => source.job === "qa" && source.enabled,
  );
  const jobs: Job[] = [
    "roster",
    "daily",
    ...(data.attendancePaste ? (["attendance"] as const) : []),
    ...(qaEnabled ? (["qa"] as const) : []),
    "all",
  ];
  const time = (stamp: string | null) =>
    stamp
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: data.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(stamp))
      : "—";
  async function run(job: Job) {
    setRequest(job);
    setError("");
    try {
      await api("/sync?job=" + job, "POST");
      status.reload();
    } catch (error) {
      setError(message(error));
    } finally {
      setRequest(null);
    }
  }
  return (
    <>
      <div className="toolbar">
        <SegmentedControl
          label="Theme"
          value={dark ? "Dark" : "Light"}
          options={["Light", "Dark"]}
          onChange={(theme) => {
            if ((theme === "Dark") !== dark) toggle();
          }}
        />
        <span className="toolbar-end">
          <button className="secondary small" onClick={logout}>
            Sign out
          </button>
        </span>
      </div>
      {!!data.mtdMismatch?.length && (
        <div className="mismatch" role="status">
          <strong>{mtdMismatch(data.mtdMismatch.length)}</strong>
          <ul>
            {data.mtdMismatch.map((agent) => (
              <li key={agent.code}>
                <Link to={"/agent/" + encodeURIComponent(agent.code)}>
                  {agent.name} ({agent.code})
                </Link>
              </li>
            ))}
          </ul>
          <small>
            Compared on the last attendance sync. Nothing was changed.
          </small>
        </div>
      )}
      {data.mtdMissing && (
        <p className="notice" role="status">
          {data.mtdMessage ?? mtdNotPasted}
        </p>
      )}
      {!!data.pasteWarnings?.length && (
        <Section title="Attendance cell warnings">
          <DataTable label="Attendance cell warnings">
            <thead>
              <tr>
                <th>Code</th>
                <th>Date</th>
                <th>Tab / column</th>
                <th>Error</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.pasteWarnings.map((warning, i) => (
                <tr key={i}>
                  <td>{warning.code ?? "Unreadable code"}</td>
                  <td>
                    {warning.date
                      ? fullDate(warning.date)
                      : "Unreadable / no date"}
                  </td>
                  <td>
                    {warning.tab} · {warning.column}
                  </td>
                  <td>{warning.error}</td>
                  <td>
                    {warning.rejected ? "Row refused" : "Cell left blank"}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Section>
      )}
      <OwnerSettings
        configHours={
          (data.config as ReadConfig).sources?.attendance?.paste ?? null
        }
      />
      <Section
        title="Sync now"
        action={<span className="muted">Cairo time</span>}
      >
        <div className="button-row panel-body">
          {jobs.map((job) => (
            <button
              className={job === "all" ? "primary" : "secondary"}
              key={job}
              disabled={!!request || !!data.running}
              onClick={() => void run(job)}
            >
              <RefreshCw
                size={15}
                className={data.running === job ? "spin" : ""}
              />
              {job === "qa" ? "QA" : job[0].toUpperCase() + job.slice(1)}
            </button>
          ))}
        </div>
        {error && <ErrorNotice>{error}</ErrorNotice>}
      </Section>
      <Backups />
      <CheckSheetLink />
      <AttendancePreview allowUpload={data.attendanceCsvUpload} />
      <div className="source-cards">
        {data.sources.map((source) => {
          const status = data.jobs[source.job];
          const latest = status?.lastRun;
          return (
            <Section
              key={source.job}
              title={source.label}
              action={
                source.enabled ? (
                  source.job === "attendance" &&
                  data.attendanceStale &&
                  latest?.ok !== false ? (
                    <span className="sync-badge bad">
                      Attendance paste is stale
                    </span>
                  ) : (
                    result(latest)
                  )
                ) : (
                  <span className="group-tag">Disabled</span>
                )
              }
            >
              <div className="panel-body source-details">
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Open source sheet <ExternalLink size={13} />
                  </a>
                ) : (
                  <span className="muted">Source link not configured</span>
                )}
                <dl>
                  <div>
                    <dt>Last success</dt>
                    <dd>{time(status?.lastSuccessAt ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Read / kept</dt>
                    <dd>
                      {latest?.rowsRead ?? "—"} / {latest?.rowsKept ?? "—"}
                    </dd>
                  </div>
                </dl>
                {latest?.error && <ErrorNotice>{latest.error}</ErrorNotice>}
                {!!latest?.warnings.length && (
                  <ul className="warnings">
                    {latest.warnings.map((warning) => (
                      <li key={warning}>{warningText(warning)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          );
        })}
      </div>
      <Section title="Sync log">
        {data.runs.length ? (
          <DataTable label="Recent sync runs">
            <thead>
              <tr>
                <th>Job</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Result</th>
                <th>Rows read</th>
                <th>Rows kept</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.job}</td>
                  <td className="nowrap">{time(run.startedAt)}</td>
                  <td className="nowrap">{time(run.finishedAt)}</td>
                  <td>{result(run)}</td>
                  <td>{run.rowsRead ?? "—"}</td>
                  <td>{run.rowsKept ?? "—"}</td>
                  <td>
                    {run.error ||
                      (run.warnings.length
                        ? run.warnings.map(warningText).join(", ")
                        : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <Empty>No sync jobs have run yet.</Empty>
        )}
      </Section>
      <StatusMap />
      <Section title="Source configuration">
        <details className="panel-body">
          <summary>View configuration</summary>
          <pre>
            {JSON.stringify(
              data.config,
              (_key, value) =>
                _key === "thresholds" && Object.keys(value).length === 0
                  ? "none set"
                  : value,
              2,
            )}
          </pre>
        </details>
      </Section>
    </>
  );
}
