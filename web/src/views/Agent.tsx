import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, X } from "lucide-react";
import type { ProfileView } from "../../../server/src/v2/profile";
import { escalationText, mprText } from "../../../server/src/v2/documents";
import { duration, shortDate } from "../../../server/src/v2/templates";
import { api } from "../api";
import {
  Avatar,
  HeatCell,
  HeatLegend,
  Severity,
  Toast,
} from "../components/design";
import { DataTable, Empty, ErrorNotice, Section } from "../components/ui";
import { BarSeries } from "../v2/charts";
import { SharedContext, useHead, useShared, useView } from "../v2/context";
import {
  DismissDialog,
  DocumentDialog,
  NoteDialog,
  useSave,
  type NoteDraft,
} from "../v2/dialogs";
import { CycleSelect, LoadError, Skeleton } from "../v2/parts";

type Profile = ProfileView & { cycles: { from: string; to: string }[] };
type Dialog =
  | { type: "note"; note: NoteDraft }
  | { type: "dismiss"; flag: Profile["flags"][number] }
  | { type: "mpr" | "escalation" }
  | null;

const resultTone: Record<string, string> = {
  kept: "good",
  "not kept": "bad",
  pending: "warn",
};

function Header({
  view,
  drawer,
  open,
}: {
  view: Profile;
  drawer: boolean;
  open: (dialog: Dialog) => void;
}) {
  const { agent } = view;
  const coach = (tab: string) =>
    `/coaching?agent=${encodeURIComponent(agent.code)}&view=${tab}`;
  const leave = () => window.dispatchEvent(new Event("dashboard:close-drawer"));
  return (
    <section className="panel profile-head" aria-label="Agent">
      <span aria-hidden="true">
        <Avatar name={agent.shortName} code={agent.code} />
      </span>
      <div className="profile-identity">
        {drawer ? <h2>{agent.name}</h2> : null}
        {!drawer && <p className="profile-name">{agent.name}</p>}
        <dl>
          {[
            ["Code", agent.code],
            ["Line", agent.line],
            ["Shift", agent.shift],
            ["Account", agent.account],
            ["Team Leader", agent.teamLeader],
            [
              "Hired",
              agent.hireDate && `${agent.hireDate} · ${agent.tenure ?? ""}`,
            ],
            ["HR status", agent.status],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || "—"}</dd>
            </div>
          ))}
        </dl>
        {agent.newHire && <span className="tag warn">{agent.newHire}</span>}
      </div>
      <div className="profile-actions">
        <Link className="primary small" to={coach("log")} onClick={leave}>
          Log coaching
        </Link>
        <Link className="secondary small" to={coach("prep")} onClick={leave}>
          Prep coaching
        </Link>
        <button
          type="button"
          className="secondary small"
          onClick={() =>
            open({
              type: "note",
              note: { date: view.today, body: "", tags: [] },
            })
          }
        >
          Add note
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => open({ type: "mpr" })}
        >
          MPR prep
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => open({ type: "escalation" })}
        >
          Draft escalation
        </button>
        {drawer && (
          <Link
            className="panel-link"
            to={"/agent/" + encodeURIComponent(agent.code)}
            onClick={leave}
          >
            Full profile <ArrowUpRight size={13} />
          </Link>
        )}
      </div>
    </section>
  );
}

function Calendar({ view }: { view: Profile }) {
  const [chosen, setChosen] = useState("");
  const day = view.calendar.find((cell) => cell.date === chosen);
  return (
    <Section
      title="This cycle, day by day"
      action={<span className="panel-note">{view.cycleLabel}</span>}
    >
      <div className="panel-body">
        <ol className="calendar-strip">
          {view.calendar.map((cell) => (
            <li key={cell.date}>
              <button
                type="button"
                className={cell.planned ? "grid-cell is-planned" : "grid-cell"}
                aria-pressed={chosen === cell.date}
                aria-label={`${shortDate(cell.date)}: ${cell.planned ? "planned " : ""}${cell.status ?? "No record"}`}
                onClick={() => setChosen(chosen === cell.date ? "" : cell.date)}
              >
                <span aria-hidden="true">
                  <HeatCell status={cell.status} />
                </span>
                {!!cell.late && <i className="mark late" />}
                {!!cell.missing && <i className="mark missing" />}
              </button>
              <small aria-hidden="true">{Number(cell.date.slice(8))}</small>
            </li>
          ))}
        </ol>
        {day && (
          <div className="day-card" role="status">
            <strong>{shortDate(day.date)}</strong>
            <dl className="day-details">
              {day.details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <HeatLegend />
        <h3>Next 7 days</h3>
        <ul className="chips">
          {view.next7.map((next) => (
            <li
              key={next.date}
              className={next.status === "Scheduled" ? "chip on" : "chip"}
            >
              {shortDate(next.date)} · {next.plan}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Coaching({ view }: { view: Profile }) {
  const { save, error } = useSave();
  const { timeline, done, target } = view.coaching;
  return (
    <Section
      title="Coaching timeline"
      action={
        <span className="panel-note">
          {done} of {target} this cycle
        </span>
      }
    >
      <div className="panel-body">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {timeline.length ? (
          <ol className="timeline">
            {timeline.map((row) => (
              <li key={row.id}>
                <div className="timeline-head">
                  <strong>{shortDate(row.date)}</strong>
                  <span className="tag">{row.type}</span>
                  <span className="quiet">{row.reasons.join(", ")}</span>
                </div>
                <p>{row.whatHappened}</p>
                {row.whatWasSaid && <p className="quiet">{row.whatWasSaid}</p>}
                <p>
                  <b>Agreed:</b> {row.nextStep}
                </p>
                <p className="step">
                  <span
                    className={"tag " + (resultTone[row.step.result] ?? "")}
                  >
                    {row.step.result}
                  </span>
                  {row.step.text}
                  {!row.acknowledged && (
                    <span className="quiet">Not yet acknowledged.</span>
                  )}
                </p>
                {row.followUp?.state === "open" && (
                  <div className="button-row">
                    {(["done", "kept", "not kept"] as const).map((state) => (
                      <button
                        key={state}
                        type="button"
                        className="secondary small"
                        aria-label={`Mark the ${shortDate(row.date)} follow-up ${state}`}
                        onClick={() =>
                          void save(
                            () =>
                              api(
                                `/v2/followups/${row.followUp!.id}`,
                                "PATCH",
                                { state },
                              ),
                            "Follow-up updated.",
                          )
                        }
                      >
                        Mark {state}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No coaching recorded for this agent.</Empty>
        )}
      </div>
    </Section>
  );
}

function Notes({
  view,
  open,
}: {
  view: Profile;
  open: (dialog: Dialog) => void;
}) {
  const { save, error } = useSave();
  const [removing, setRemoving] = useState<number | null>(null);
  return (
    <Section
      title="Private notes"
      action={
        <button
          type="button"
          className="secondary small"
          onClick={() =>
            open({
              type: "note",
              note: { date: view.today, body: "", tags: [] },
            })
          }
        >
          New note
        </button>
      }
    >
      <div className="panel-body">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {view.notes.length ? (
          <ul className="notes">
            {view.notes.map((note) => (
              <li key={note.id}>
                <div className="timeline-head">
                  <strong>{shortDate(note.date)}</strong>
                  {note.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <p>{note.body}</p>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => open({ type: "note", note })}
                  >
                    Edit
                  </button>
                  {removing === note.id ? (
                    <button
                      type="button"
                      className="danger small"
                      onClick={() =>
                        void save(
                          () => api(`/v2/notes/${note.id}`, "DELETE"),
                          "Note deleted.",
                        )
                      }
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => setRemoving(note.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No private notes.</Empty>
        )}
        {!!view.earlierNotes.length && (
          <>
            <h3>Earlier notes</h3>
            <ul className="notes">
              {view.earlierNotes.map((note) => (
                <li key={note.id}>
                  <div className="timeline-head">
                    <strong>{shortDate(note.date)}</strong>
                    {note.followUpDate && (
                      <span className="quiet">
                        Follow-up {shortDate(note.followUpDate)}
                      </span>
                    )}
                  </div>
                  <p>{note.whatHappened}</p>
                  {note.whatWasSaid && (
                    <p className="quiet">{note.whatWasSaid}</p>
                  )}
                  {note.nextStep && (
                    <p>
                      <b>Agreed:</b> {note.nextStep}
                    </p>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={note.done}
                      onChange={() =>
                        void save(
                          () =>
                            api(`/notes/${note.id}`, "PATCH", {
                              done: !note.done,
                            }),
                          "Note updated.",
                        )
                      }
                    />
                    Done
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Section>
  );
}

function Details({ view, drawer }: { view: Profile; drawer: boolean }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const trend = (key: "lateMinutes" | "missingMinutes" | "qa") =>
    view.trends.map((row) => ({ label: row.label, value: row[key] }));
  return (
    <div className={drawer ? "profile in-drawer" : "profile"}>
      <Header view={view} drawer={drawer} open={setDialog} />
      {!!view.flags.length && (
        <Section title="Open flags">
          <ul className="flag-list">
            {view.flags.map((flag) => (
              <li key={flag.id}>
                <Severity level={flag.severity} />
                <div>
                  <strong>{flag.reason}</strong>
                  <small>{flag.detail}</small>
                </div>
                <button
                  type="button"
                  className="secondary small"
                  aria-label={"Dismiss: " + flag.reason}
                  onClick={() => setDialog({ type: "dismiss", flag })}
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section
        title="Cycle scorecard"
        action={<span className="panel-note">Against the team average</span>}
      >
        <dl className="scorecard">
          {view.scorecard.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>
                <strong>{row.value}</strong>
                <small>Team {row.team}</small>
                {row.note && <small>{row.note}</small>}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      <Calendar view={view} />
      <Section title="Last 6 cycles">
        <div className="trend-grid">
          <BarSeries
            title="Late time"
            bars={trend("lateMinutes")}
            format={duration}
          />
          <BarSeries
            title="Missing time"
            bars={trend("missingMinutes")}
            format={duration}
          />
          {view.qa.connected || view.trends.some((row) => row.qa !== null) ? (
            <BarSeries
              title="QA average"
              bars={trend("qa")}
              format={(value) => value + "%"}
              floor={60}
            />
          ) : (
            <Empty>QA is not connected.</Empty>
          )}
        </div>
      </Section>
      <Section title="Patterns">
        {view.patterns.length ? (
          <ul className="facts">
            {view.patterns.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        ) : (
          <Empty>No repeating pattern in the recorded days.</Empty>
        )}
      </Section>
      <Coaching view={view} />
      <Notes view={view} open={setDialog} />
      <Section title="Discrepancy history">
        {view.discrepancies.length ? (
          <DataTable label="Discrepancy history">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rule</th>
                <th>Missing</th>
                <th>State</th>
                <th>TL comment</th>
              </tr>
            </thead>
            <tbody>
              {view.discrepancies.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.date}</td>
                  <td>{row.ruleId}</td>
                  <td>{row.missing || "—"}</td>
                  <td>{row.state}</td>
                  <td>{row.tlComment || "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <Empty>No discrepancies recorded.</Empty>
        )}
      </Section>
      {!!view.dismissed.length && (
        <details className="panel dismissed">
          <summary>Dismissed flags ({view.dismissed.length})</summary>
          <ul className="facts">
            {view.dismissed.map((row) => (
              <li key={row.id}>
                {row.id.split("|").slice(1).join(" · ")} · dismissed{" "}
                {shortDate(row.at)}: {row.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {dialog?.type === "note" && (
        <NoteDialog code={view.agent.code} note={dialog.note} close={close} />
      )}
      {dialog?.type === "dismiss" && (
        <DismissDialog
          flag={dialog.flag}
          name={view.agent.shortName}
          close={close}
        />
      )}
      {(dialog?.type === "mpr" || dialog?.type === "escalation") && (
        <DocumentDialog
          title={dialog.type === "mpr" ? "MPR prep" : "Escalation draft"}
          text={(notes) =>
            (dialog.type === "mpr" ? mprText : escalationText)(view, notes)
          }
          close={close}
        />
      )}
    </div>
  );
}

function AgentProfile({ code, drawer }: { code: string; drawer: boolean }) {
  const [params, setParams] = useSearchParams();
  const cycle = drawer ? null : params.get("cycle");
  const result = useView<Profile>(
    "/v2/agents/" +
      encodeURIComponent(code) +
      (cycle ? `?cycle=${encodeURIComponent(cycle)}` : ""),
  );
  const view = result.data;
  if (!view)
    return result.error ? (
      <LoadError
        title="Agent profile"
        error={result.error}
        retry={result.reload}
      />
    ) : (
      <Skeleton className="screen-size" label="agent profile" />
    );
  return (
    <>
      {!drawer && (
        <>
          <PageTitle view={view} />
          <div className="toolbar">
            <CycleSelect
              cycles={view.cycles}
              value={view.cycle.from}
              onChange={(from) => setParams({ cycle: from })}
            />
            <span className="toolbar-end">
              <Link className="panel-link" to="/team">
                ← Team
              </Link>
            </span>
          </div>
        </>
      )}
      <Details view={view} drawer={drawer} />
    </>
  );
}

function PageTitle({ view }: { view: Profile }) {
  useHead(view.agent.firstName || view.agent.code);
  return null;
}

/** A modal drawer hides the page's toast, so it shows its own. */
function DrawerNotices({ children }: { children: ReactNode }) {
  const shared = useShared();
  const [toast, setToast] = useState("");
  const done = useCallback(() => setToast(""), []);
  const value = useMemo(() => ({ ...shared, notify: setToast }), [shared]);
  return (
    <SharedContext.Provider value={value}>
      {children}
      {toast && <Toast close={done}>{toast}</Toast>}
    </SharedContext.Provider>
  );
}

export function Agent({ code, close }: { code?: string; close?: () => void }) {
  const params = useParams();
  const id = code ?? params.code ?? "";
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!close || !dialog.current) return;
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    window.addEventListener("dashboard:close-drawer", close);
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
      window.removeEventListener("dashboard:close-drawer", close);
    };
  }, [close]);
  if (!close) return <AgentProfile key={id} code={id} drawer={false} />;
  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-label="Agent profile"
      onCancel={(event) => {
        // A dialog opened inside the drawer handles its own Escape.
        if (event.target === dialog.current) close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="drawer-inner">
        <button
          className="icon-button drawer-close"
          onClick={close}
          aria-label="Close agent profile"
        >
          <X size={20} />
        </button>
        <DrawerNotices>
          <AgentProfile code={id} drawer />
        </DrawerNotices>
      </div>
    </dialog>
  );
}
