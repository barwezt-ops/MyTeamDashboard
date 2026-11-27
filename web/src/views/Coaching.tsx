import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { CoachingView, PrepView } from "../../../server/src/v2/coaching";
import {
  coachingTypes,
  measures,
  reasons,
} from "../../../server/src/v2/choices";
import { shortDate } from "../../../server/src/v2/templates";
import { api } from "../api";
import { Avatar, ProgressRing, SegmentedControl } from "../components/design";
import { DataTable, Empty, ErrorNotice, Section } from "../components/ui";
import { useHead, useShared, useView } from "../v2/context";
import { copy, downloadCsv, tableHtml, tableText } from "../v2/copy";
import { useSave } from "../v2/dialogs";
import { LoadError, Person, Skeleton, useCopy } from "../v2/parts";

type Go = (view: string, agent?: string) => void;

const tabs = [
  ["overview", "Overview"],
  ["prep", "Prep sheet"],
  ["log", "Log coaching"],
  ["followups", "Follow-ups"],
  ["history", "History"],
  ["fairness", "Fairness"],
] as const;

function Overview({ view, go }: { view: CoachingView; go: Go }) {
  const { totals } = view;
  return (
    <>
      <section className="panel coaching-overview" aria-label="Team pace">
        <div className="big-ring">
          <ProgressRing
            done={totals.done}
            total={totals.total}
            expected={totals.expected}
          />
        </div>
        <dl>
          <div>
            <dt>Days left in the cycle</dt>
            <dd>{view.daysToFinish}</dd>
          </div>
          <div>
            <dt>Still to do</dt>
            <dd>{totals.due}</dd>
          </div>
          <div>
            <dt>Behind pace</dt>
            <dd>{totals.behind}</dd>
          </div>
        </dl>
        <p className="summary">{view.pace}</p>
      </section>
      <Section
        title="Who needs it most"
        action={
          <span className="panel-note">
            Open flags first, then fewest this cycle, then longest ago
          </span>
        }
      >
        {view.agents.length ? (
          <ul className="agent-cards">
            {view.agents.map((agent) => (
              <li key={agent.code}>
                <Person name={agent.name} code={agent.code} />
                <div
                  className="coaching-bars"
                  role="img"
                  aria-label={`${agent.done} of ${totals.target} coachings`}
                >
                  {Array.from({ length: totals.target }, (_, i) => (
                    <i key={i} className={i < agent.done ? "done" : ""} />
                  ))}
                  <span>
                    {agent.done}/{totals.target}
                  </span>
                </div>
                <small>
                  {agent.last
                    ? `Last ${shortDate(agent.last)}`
                    : "Not coached yet"}
                  {agent.flags ? ` · ${agent.flags} open` : ""}
                  {agent.behind ? " · behind pace" : ""}
                </small>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary small"
                    aria-label={`Prep ${agent.name}`}
                    onClick={() => go("prep", agent.code)}
                  >
                    Prep
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    aria-label={`Log coaching for ${agent.name}`}
                    onClick={() => go("log", agent.code)}
                  >
                    Log
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No active agents.</Empty>
        )}
      </Section>
    </>
  );
}

function AgentSelect({
  view,
  value,
  onChange,
  required = false,
}: {
  view: CoachingView;
  value: string;
  onChange: (code: string) => void;
  required?: boolean;
}) {
  const sorted = [...view.agents].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <label>
      <span>Agent</span>
      <select
        aria-label="Agent"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose an agent</option>
        {sorted.map((agent) => (
          <option key={agent.code} value={agent.code}>
            {agent.name} · {agent.code}
          </option>
        ))}
      </select>
    </label>
  );
}

function PrepSheet({ code, go }: { code: string; go: Go }) {
  const result = useView<PrepView>(
    "/v2/coaching/prep/" + encodeURIComponent(code),
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const prep = result.data;
  if (!prep)
    return result.error ? (
      <LoadError
        title="Prep sheet"
        error={result.error}
        retry={result.reload}
      />
    ) : (
      <Skeleton className="screen-size" label="prep sheet" />
    );
  const reason = (chosen ?? prep.suggested[0]) as (typeof reasons)[number];
  return (
    <div className="prep">
      <Section
        title={prep.name}
        action={
          <div className="button-row">
            <span className="panel-note">
              {prep.done} of {prep.target} this cycle
            </span>
            <button
              type="button"
              className="primary small"
              onClick={() => go("log", prep.code)}
            >
              Log this coaching
            </button>
          </div>
        }
      >
        <div className="prep-facts">
          {prep.sections.map((section) => (
            <article key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.summary}</p>
              {!!section.lines.length && (
                <ul>
                  {section.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </Section>
      <Section
        title="Questions to ask"
        action={
          <SegmentedControl
            label="Reason"
            value={reason}
            options={[...reasons]}
            onChange={setChosen}
          />
        }
      >
        <ul className="facts">
          {prep.prompts[reason].map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

const blank = (today: string) => ({
  date: today,
  type: "corrective" as string,
  reasons: [] as string[],
  evidence: [] as string[],
  whatHappened: "",
  whatWasSaid: "",
  nextStep: "",
  followUpDate: "",
  acknowledged: false,
  measure: "none" as string,
  target: "",
});

/** Recorded incidents in the cycle of the coaching date. */
function Evidence({
  code,
  date,
  selected,
  onToggle,
}: {
  code: string;
  date: string;
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  const result = useView<PrepView>(
    `/v2/coaching/prep/${encodeURIComponent(code)}?cycle=${date}`,
  );
  if (result.error)
    return <ErrorNotice retry={result.reload}>{result.error}</ErrorNotice>;
  if (!result.data) return <p className="quiet">Loading incidents…</p>;
  if (!result.data.evidence.length)
    return <p className="quiet">No incidents recorded in this cycle.</p>;
  return result.data.evidence.map((item) => (
    <label className="check" key={item.id}>
      <input
        type="checkbox"
        checked={selected.includes(item.id)}
        onChange={(e) => onToggle(item.id, e.target.checked)}
      />
      {item.label}
    </label>
  ));
}

const measureLabels: Record<string, string> = {
  none: "Not measured from data",
  lateness: "Lateness incidents",
  missing: "Missing minutes",
  breaks: "Days with an exceeded break",
};

function LogForm({
  view,
  code,
  go,
}: {
  view: CoachingView;
  code: string;
  go: Go;
}) {
  const [draft, setDraft] = useState(() => blank(view.today));
  const [problem, setProblem] = useState("");
  const { save, busy, error } = useSave();
  const set = (patch: Partial<typeof draft>) =>
    setDraft((old) => ({ ...old, ...patch }));
  const toggle = (list: string[], value: string, on: boolean) =>
    on ? [...list, value] : list.filter((item) => item !== value);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem("");
    if (!draft.reasons.length) return setProblem("Choose at least one reason.");
    const measured = draft.measure !== "none";
    if (measured && (!draft.followUpDate || draft.target === ""))
      return setProblem(
        "A measured next step needs a limit and a follow-up date.",
      );
    const saved = await save(
      () =>
        api("/v2/coachings", "POST", {
          code,
          date: draft.date,
          type: draft.type,
          reasons: draft.reasons,
          evidence: draft.evidence,
          whatHappened: draft.whatHappened,
          whatWasSaid: draft.whatWasSaid,
          nextStep: draft.nextStep,
          followUpDate: draft.followUpDate || null,
          acknowledged: draft.acknowledged,
          measure: draft.measure,
          target: measured ? Number(draft.target) : null,
        }),
      "Coaching saved.",
    );
    if (saved) {
      setDraft(blank(view.today));
      go("history", code);
    }
  }
  return (
    <Section title="Log coaching">
      <form className="record-form log-form" onSubmit={submit}>
        <div className="form-pair">
          <AgentSelect
            view={view}
            value={code}
            required
            onChange={(next) => {
              set({ evidence: [] });
              go("log", next);
            }}
          />
          <label>
            Date
            <input
              type="date"
              required
              max={view.today}
              value={draft.date}
              onChange={(e) => set({ date: e.target.value, evidence: [] })}
            />
          </label>
          <label>
            Type
            <select
              value={draft.type}
              onChange={(e) => set({ type: e.target.value })}
            >
              {coachingTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Reasons</legend>
          {reasons.map((reason) => (
            <label className="check" key={reason}>
              <input
                type="checkbox"
                checked={draft.reasons.includes(reason)}
                onChange={(e) =>
                  set({
                    reasons: toggle(draft.reasons, reason, e.target.checked),
                  })
                }
              />
              {reason}
            </label>
          ))}
        </fieldset>
        <fieldset className="evidence">
          <legend>Linked evidence</legend>
          {code ? (
            <Evidence
              key={code}
              code={code}
              date={draft.date || view.today}
              selected={draft.evidence}
              onToggle={(id, on) =>
                set({ evidence: toggle(draft.evidence, id, on) })
              }
            />
          ) : (
            <p className="quiet">Choose an agent to list recorded incidents.</p>
          )}
        </fieldset>
        <label>
          What happened
          <textarea
            required
            aria-label="What happened"
            value={draft.whatHappened}
            onChange={(e) => set({ whatHappened: e.target.value })}
          />
        </label>
        <label>
          What was said
          <textarea
            aria-label="What was said"
            value={draft.whatWasSaid}
            onChange={(e) => set({ whatWasSaid: e.target.value })}
          />
        </label>
        <label>
          Agreed next step
          <textarea
            required
            aria-label="Agreed next step"
            value={draft.nextStep}
            onChange={(e) => set({ nextStep: e.target.value })}
          />
        </label>
        <div className="form-pair">
          <label>
            Follow-up date
            <input
              type="date"
              min={draft.date}
              value={draft.followUpDate}
              onChange={(e) => set({ followUpDate: e.target.value })}
            />
          </label>
          <label>
            Measure the next step by
            <select
              value={draft.measure}
              onChange={(e) => set({ measure: e.target.value })}
            >
              {measures.map((measure) => (
                <option key={measure} value={measure}>
                  {measureLabels[measure]}
                </option>
              ))}
            </select>
          </label>
          {draft.measure !== "none" && (
            <label>
              Most allowed until the follow-up
              <input
                type="number"
                min={0}
                step={1}
                value={draft.target}
                onChange={(e) => set({ target: e.target.value })}
              />
            </label>
          )}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.acknowledged}
            onChange={(e) => set({ acknowledged: e.target.checked })}
          />
          Agent acknowledged
        </label>
        {(problem || error) && <ErrorNotice>{problem || error}</ErrorNotice>}
        <div className="button-row">
          <button className="primary" disabled={busy || !code}>
            {busy ? "Saving…" : "Save coaching"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function FollowUps({ view }: { view: CoachingView }) {
  const { save, error } = useSave();
  const groups = [
    ["overdue", "Overdue"],
    ["today", "Due today"],
    ["upcoming", "Coming up"],
    ["closed", "Closed"],
  ] as const;
  return (
    <>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {groups.map(([group, title]) => {
        const rows = view.followUps.filter((row) => row.group === group);
        const shown =
          group === "closed" ? [...rows].reverse().slice(0, 20) : rows;
        return (
          <Section
            key={group}
            title={title}
            action={<span className="panel-note">{rows.length}</span>}
          >
            {shown.length ? (
              <ul className="flag-list">
                {shown.map((row) => (
                  <li key={row.key}>
                    <span aria-hidden="true">
                      <Avatar name={row.name} code={row.code} />
                    </span>
                    <div>
                      <strong>
                        {row.name} · {shortDate(row.date)}
                      </strong>
                      <small>
                        Agreed {shortDate(row.from)}: {row.agreed}
                      </small>
                      {row.measured && row.group !== "closed" && (
                        <small>{row.measured.text}</small>
                      )}
                    </div>
                    {row.group === "closed" ? (
                      <span className="tag">{row.state}</span>
                    ) : null}
                    <div className="button-row">
                      {(row.kind === "note"
                        ? ["done"]
                        : row.group === "closed"
                          ? ["open"]
                          : ["done", "kept", "not kept"]
                      ).map((state) => {
                        const label =
                          state === "open" ? "Reopen" : `Mark ${state}`;
                        return (
                          <button
                            key={state}
                            type="button"
                            className="secondary small"
                            aria-label={`${label}: ${row.name}, ${shortDate(row.date)}`}
                            onClick={() =>
                              void save(
                                () =>
                                  row.kind === "note"
                                    ? api(`/notes/${row.id}`, "PATCH", {
                                        done: true,
                                      })
                                    : api(`/v2/followups/${row.id}`, "PATCH", {
                                        state,
                                      }),
                                "Follow-up updated.",
                              )
                            }
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nothing here.</Empty>
            )}
          </Section>
        );
      })}
    </>
  );
}

const documentation = (rows: CoachingView["history"]) => ({
  headers: [
    "Agent",
    "Date",
    "What happened",
    "What was said",
    "Agreed next step",
    "Follow-up date",
  ],
  rows: rows.map((row) => [
    row.name,
    row.date,
    row.whatHappened,
    row.whatWasSaid,
    row.nextStep,
    row.followUpDate ?? "",
  ]),
});

function History({
  view,
  code,
  go,
}: {
  view: CoachingView;
  code: string;
  go: Go;
}) {
  const [type, setType] = useState("");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const run = useCopy();
  const rows = useMemo(
    () =>
      view.history.filter(
        (row) =>
          (!code || row.code === code) &&
          (!type || row.type === type) &&
          (!reason || row.reasons.includes(reason as never)) &&
          (!from || row.date >= from) &&
          (!to || row.date <= to),
      ),
    [view.history, code, type, reason, from, to],
  );
  const documented = (list: typeof rows) =>
    run(() => {
      const table = documentation(list);
      return copy(tableText(table), tableHtml(table));
    }, "Documentation copied.");
  return (
    <>
      <div className="toolbar">
        <AgentSelect
          view={view}
          value={code}
          onChange={(next) => go("history", next)}
        />
        <label>
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {coachingTypes.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">All reasons</option>
            {reasons.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <span className="toolbar-end">
          <button
            type="button"
            className="secondary small"
            disabled={!rows.length}
            onClick={() => documented(rows)}
          >
            Copy as documentation
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv("coaching-history.csv", documentation(rows))
            }
          >
            Export CSV
          </button>
        </span>
      </div>
      <Section
        title="History"
        action={<span className="panel-note">{rows.length} entries</span>}
      >
        {rows.length ? (
          <ol className="timeline panel-body">
            {rows.map((row) => (
              <li key={row.id}>
                <div className="timeline-head">
                  <Person name={row.name} code={row.code} />
                  <strong>{shortDate(row.date)}</strong>
                  <span className="tag">{row.type}</span>
                  <span className="quiet">{row.reasons.join(", ")}</span>
                  <button
                    type="button"
                    className="secondary small"
                    aria-label={`Copy ${row.name}, ${shortDate(row.date)}`}
                    onClick={() => documented([row])}
                  >
                    Copy
                  </button>
                </div>
                <p>{row.whatHappened}</p>
                {row.whatWasSaid && <p className="quiet">{row.whatWasSaid}</p>}
                <p>
                  <b>Agreed:</b> {row.nextStep}
                </p>
                <p className="step">
                  <span className="tag">{row.step.result}</span>
                  {row.step.text}
                  {row.acknowledged ? " Acknowledged." : " Not acknowledged."}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No coaching matches these filters.</Empty>
        )}
      </Section>
    </>
  );
}

function Fairness({ view }: { view: CoachingView }) {
  const [period, setPeriod] = useState("This cycle");
  const key = period === "This cycle" ? "cycle" : "all";
  const columns = [
    ["coachings", "Coachings"],
    ["corrective", "Corrective"],
    ["recognition", "Recognition"],
    ["followUp", "Follow-up"],
    ["notes", "Notes"],
  ] as const;
  const most = Math.max(1, ...view.fairness.map((row) => row[key].coachings));
  return (
    <Section
      title="Fairness"
      action={
        <SegmentedControl
          label="Period"
          value={period}
          options={["This cycle", "All time"]}
          onChange={setPeriod}
        />
      }
    >
      <p className="panel-intro">
        Counts per agent, side by side. “All time” covers every coaching and
        note on record.
      </p>
      {view.fairness.length ? (
        <DataTable label="Coaching counts">
          <thead>
            <tr>
              <th>Agent</th>
              {columns.map(([column, label]) => (
                <th key={column} className="numeric">
                  {label}
                </th>
              ))}
              <th>
                <span className="visually-hidden">Coachings as a bar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.fairness.map((row) => (
              <tr key={row.code}>
                <td>
                  <Person name={row.name} code={row.code} />
                </td>
                {columns.map(([column]) => (
                  <td key={column} className="numeric mono">
                    {row[key][column]}
                  </td>
                ))}
                <td className="count-bar" aria-hidden="true">
                  <i
                    style={{ width: `${(row[key].coachings / most) * 100}%` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Team</th>
              {columns.map(([column]) => (
                <td key={column} className="numeric mono">
                  {view.fairness.reduce((s, row) => s + row[key][column], 0)}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </DataTable>
      ) : (
        <Empty>No active agents.</Empty>
      )}
    </Section>
  );
}

export function Coaching() {
  const [params, setParams] = useSearchParams();
  const result = useView<CoachingView>("/v2/coaching");
  const view = result.data;
  useHead("Coaching", view?.summary);
  const { openAgent } = useShared();
  const tab = params.get("view") ?? "overview";
  const code = params.get("agent") ?? "";
  const go: Go = (next, agent) =>
    setParams(
      Object.fromEntries(
        Object.entries({ view: next, agent: agent ?? "" }).filter(
          ([, value]) => value,
        ),
      ),
    );
  if (!view)
    return result.error ? (
      <LoadError title="Coaching" error={result.error} retry={result.reload} />
    ) : (
      <Skeleton className="screen-size" label="coaching" />
    );
  const known = view.agents.some((agent) => agent.code === code) ? code : "";
  return (
    <>
      <nav className="tabs" aria-label="Coaching sections">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            to={`?view=${key}${known ? `&agent=${known}` : ""}`}
            aria-current={tab === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "prep" ? (
        <>
          <div className="toolbar">
            <AgentSelect
              view={view}
              value={known}
              onChange={(next) => go("prep", next)}
            />
            {known && (
              <button
                type="button"
                className="secondary small"
                onClick={() => openAgent(known)}
              >
                Open profile
              </button>
            )}
          </div>
          {known ? (
            <PrepSheet key={known} code={known} go={go} />
          ) : (
            <Section title="Prep sheet">
              <Empty>Choose an agent to pull their facts together.</Empty>
            </Section>
          )}
        </>
      ) : tab === "log" ? (
        <LogForm view={view} code={known} go={go} />
      ) : tab === "followups" ? (
        <FollowUps view={view} />
      ) : tab === "history" ? (
        <History view={view} code={known} go={go} />
      ) : tab === "fairness" ? (
        <Fairness view={view} />
      ) : (
        <Overview view={view} go={go} />
      )}
    </>
  );
}
