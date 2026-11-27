// The settings the owner controls in the app. Every threshold says whether it
// is set.
import { useState, type FormEvent, type ReactNode } from "react";
import type { V2Settings } from "../../../server/src/v2/settings";
import type { BoardView } from "../../../server/src/v2/board";
import {
  defaultEmailSubject,
  defaultTemplate,
  globalFields,
  rowFields,
} from "../../../server/src/v2/template";
import { noLine } from "../../../server/src/v2/queues";
import {
  defaultMprTemplate,
  mprFields,
} from "../../../server/src/v2/documents";
import { api } from "../api";
import { ErrorNotice, Loading, Section } from "../components/ui";
import { useView } from "../v2/context";
import { useSave } from "../v2/dialogs";

const show = (value: number | null) => (value === null ? "" : String(value));
const read = (value: string) => (value.trim() === "" ? null : Number(value));

function SaveForm({
  title,
  id,
  intro,
  values,
  done,
  children,
}: {
  title: string;
  id: string;
  intro?: string;
  values: () => Partial<V2Settings>;
  done: string;
  children: ReactNode;
}) {
  const { save, busy, error } = useSave();
  function submit(event: FormEvent) {
    event.preventDefault();
    void save(() => api("/v2/settings", "PATCH", values()), done);
  }
  return (
    <div id={id}>
      <Section title={title}>
        <form className="record-form panel-body" onSubmit={submit}>
          {intro && <p className="quiet">{intro}</p>}
          {children}
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="button-row">
            <button
              className="primary small"
              disabled={busy}
              aria-label={`Save ${title.toLowerCase()}`}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Section>
    </div>
  );
}

const SetTag = ({ set }: { set: boolean }) => (
  <span className={set ? "tag good" : "tag"}>
    {set ? "set by owner" : "not set"}
  </span>
);

const thresholds = [
  [
    "latenessIncidents",
    "Lateness incidents in a cycle",
    "Urgent at or above",
    1,
  ],
  ["missingMinutes", "Missing minutes in a cycle", "Urgent at or above", 1],
  ["missingDays", "Days with missing time", "Urgent at or above", 1],
  ["missingWindowDays", "…within the last days", "Window ending yesterday", 1],
  ["breakConsecutive", "Exceeded breaks in a row", "Urgent at or above", 1],
  ["absentDays", "NCNS/AWOL days in a cycle", "Urgent at or above", 1],
  ["qaBelow", "QA cycle average (%)", "Urgent below", 0],
  ["noQaDays", "Days without a QA evaluation", "Urgent at or above", 1],
] as const;

function Thresholds({ settings }: { settings: V2Settings }) {
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(thresholds.map(([key]) => [key, show(settings[key])])),
  );
  const [target, setTarget] = useState(String(settings.coachingTarget));
  return (
    <SaveForm
      title="Flags and thresholds"
      id="thresholds"
      intro="Leave a field empty to keep it off. Only a threshold you set can make something urgent."
      done="Thresholds saved."
      values={() => ({
        ...Object.fromEntries(
          thresholds.map(([key]) => [key, read(draft[key])]),
        ),
        coachingTarget: Number(target),
      })}
    >
      <div className="setting-list">
        {thresholds.map(([key, label, help, min]) => (
          <div className="setting" key={key}>
            <label htmlFor={"threshold-" + key}>
              {label}
              <small>{help}</small>
            </label>
            <input
              id={"threshold-" + key}
              type="number"
              min={min}
              max={key === "qaBelow" ? 100 : undefined}
              step={key === "qaBelow" ? "any" : 1}
              value={draft[key]}
              placeholder="Off"
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
            <SetTag set={settings[key] !== null} />
          </div>
        ))}
        <div className="setting">
          <label htmlFor="coaching-target">
            Coachings per agent per cycle
            <small>Your KPI. Pace follows from it.</small>
          </label>
          <input
            id="coaching-target"
            type="number"
            min={1}
            max={31}
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <SetTag set />
        </div>
      </div>
    </SaveForm>
  );
}

const hours = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const hourLabel = (hour: number) => String(hour).padStart(2, "0") + ":00";

function Cycle({
  settings,
  configHours,
}: {
  settings: V2Settings;
  configHours: { startHour: number; endHour: number } | null;
}) {
  const [start, setStart] = useState(String(settings.cycleStartDay));
  const own = settings.attendanceHours;
  const [custom, setCustom] = useState(!!own);
  const [from, setFrom] = useState(own?.start ?? configHours?.startHour ?? 0);
  const [to, setTo] = useState(own?.end ?? configHours?.endHour ?? 24);
  return (
    <SaveForm
      title="Cycle and attendance reads"
      id="cycle"
      done="Cycle settings saved."
      values={() => ({
        cycleStartDay: Number(start),
        attendanceHours: custom ? { start: from, end: to } : null,
      })}
    >
      <label>
        Cycle start day of the month
        <input
          type="number"
          min={1}
          max={28}
          required
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={custom}
          onChange={(e) => setCustom(e.target.checked)}
        />
        Choose attendance read hours here
      </label>
      {custom ? (
        <div className="form-pair">
          <label>
            Read from
            <select value={from} onChange={(e) => setFrom(+e.target.value)}>
              {hours(0, 23).map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Until
            <select value={to} onChange={(e) => setTo(+e.target.value)}>
              {hours(0, 24).map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p className="quiet">
          {configHours
            ? `From the config file: ${hourLabel(configHours.startHour)} to ${hourLabel(configHours.endHour)}, Cairo time.`
            : "Hourly reads apply to the attendance paste workbook, which is not configured."}
        </p>
      )}
    </SaveForm>
  );
}

function Staffing({
  settings,
  lines,
}: {
  settings: V2Settings;
  lines: string[];
}) {
  const names = [
    ...new Set([...lines, ...Object.keys(settings.staffing)]),
  ].sort();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(settings.staffing).map(([line, n]) => [line, String(n)]),
    ),
  );
  return (
    <SaveForm
      title="Staffing baselines"
      id="staffing"
      intro="The number of people each line needs per day. Gaps are shown only where you set one."
      done="Staffing baselines saved."
      values={() => ({
        staffing: Object.fromEntries(
          names.flatMap((line) => {
            const value = read(draft[line] ?? "");
            return value === null ? [] : [[line, value]];
          }),
        ),
      })}
    >
      {names.length ? (
        <div className="setting-list">
          {names.map((line, i) => (
            <div className="setting" key={line}>
              <label htmlFor={"staffing-" + i}>{line}</label>
              <input
                id={"staffing-" + i}
                type="number"
                min={0}
                step={1}
                placeholder="Off"
                value={draft[line] ?? ""}
                onChange={(e) => setDraft({ ...draft, [line]: e.target.value })}
              />
              <SetTag set={settings.staffing[line] !== undefined} />
            </div>
          ))}
        </div>
      ) : (
        <p className="quiet">
          Lines appear here once the line and queue tab has been read.
        </p>
      )}
    </SaveForm>
  );
}

function ReportTemplate({ settings }: { settings: V2Settings }) {
  const [text, setText] = useState(settings.reportTemplate);
  return (
    <SaveForm
      title="Report layout"
      id="report-template"
      intro="Paste your end-of-day layout once, then replace sample values with placeholders. Leave empty to use the default. Agent names are never included: name placeholders read Agent."
      done="Report layout saved."
      values={() => ({ reportTemplate: text })}
    >
      <label>
        Layout
        <textarea
          aria-label="Report layout"
          className="document-text template-text"
          maxLength={20000}
          value={text}
          placeholder={defaultTemplate}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <details className="placeholders">
        <summary>Placeholders</summary>
        <p>
          A line with a <code>{"{row.…}"}</code> placeholder repeats for every
          agent. A line with <code>{"{exception.…}"}</code> repeats only for
          agents with an exception.
        </p>
        <p className="mono">
          {globalFields.map((field) => `{${field}}`).join(" ")}
        </p>
        <p className="mono">
          {rowFields.map((field) => `{row.${field}}`).join(" ")}
        </p>
      </details>
      <div className="button-row">
        <button
          type="button"
          className="secondary small"
          onClick={() => setText(defaultTemplate)}
        >
          Start from the default
        </button>
        <SetTag set={!!settings.reportTemplate.trim()} />
      </div>
    </SaveForm>
  );
}

function EmailLayout({ settings }: { settings: V2Settings }) {
  const [account, setAccount] = useState(settings.reportAccount);
  const [subject, setSubject] = useState(settings.emailSubject);
  return (
    <SaveForm
      title="Attendance email"
      id="email-layout"
      intro="The subject above the attendance table on Reports. {account} and {D Month YYYY} are filled in."
      done="Attendance email saved."
      values={() => ({ reportAccount: account, emailSubject: subject })}
    >
      <label>
        Account
        <input
          maxLength={200}
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        />
      </label>
      <label>
        Subject layout
        <input
          maxLength={300}
          value={subject}
          placeholder={defaultEmailSubject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <div className="button-row">
        <SetTag set={!!settings.reportAccount} />
      </div>
    </SaveForm>
  );
}

function MprLayout({ settings }: { settings: V2Settings }) {
  const [text, setText] = useState(settings.mprTemplate);
  return (
    <SaveForm
      title="MPR layout"
      id="mpr-layout"
      intro="The MPR preparation text. Leave empty to use the default."
      done="MPR layout saved."
      values={() => ({ mprTemplate: text })}
    >
      <label>
        Layout
        <textarea
          aria-label="MPR layout"
          className="document-text template-text"
          maxLength={20000}
          value={text}
          placeholder={defaultMprTemplate}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <details className="placeholders">
        <summary>MPR placeholders</summary>
        <p className="mono">
          {mprFields.map((field) => `{${field}}`).join(" ")}
        </p>
        <p>{"{notes}"} stays empty unless you tick “Include private notes”.</p>
      </details>
      <div className="button-row">
        <button
          type="button"
          className="secondary small"
          onClick={() => setText(defaultMprTemplate)}
        >
          Start from the default
        </button>
        <SetTag set={!!settings.mprTemplate.trim()} />
      </div>
    </SaveForm>
  );
}

export function OwnerSettings({
  configHours,
}: {
  configHours: { startHour: number; endHour: number } | null;
}) {
  const settings = useView<V2Settings>("/v2/settings");
  const queues = useView<BoardView>("/v2/queues");
  const error = settings.error || queues.error;
  if (error && (!settings.data || !queues.data))
    return (
      <ErrorNotice
        retry={() => {
          settings.reload();
          queues.reload();
        }}
      >
        {error}
      </ErrorNotice>
    );
  if (!settings.data || !queues.data) return <Loading />;
  const saved = settings.data;
  // Each form resets only when its own saved values change, so saving one
  // keeps what is being typed in the others.
  const key = (...fields: (keyof V2Settings)[]) =>
    JSON.stringify(fields.map((field) => [field, saved[field]]));
  return (
    <div className="owner-settings">
      <Thresholds
        key={key(...thresholds.map(([field]) => field), "coachingTarget")}
        settings={saved}
      />
      <Cycle
        key={key("cycleStartDay", "attendanceHours")}
        settings={saved}
        configHours={configHours}
      />
      <Staffing
        key={key("staffing")}
        settings={saved}
        lines={queues.data.board
          .map((queue) => queue.line)
          .filter((line) => line !== noLine)}
      />
      <ReportTemplate key={key("reportTemplate")} settings={saved} />
      <EmailLayout
        key={key("reportAccount", "emailSubject")}
        settings={saved}
      />
      <MprLayout key={key("mprTemplate")} settings={saved} />
    </div>
  );
}
