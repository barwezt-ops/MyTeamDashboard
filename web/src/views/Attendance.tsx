import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { GridView } from "../../../server/src/v2/grid";
import { absenceTypes } from "../../../server/src/v2/absences";
import { heatStatuses } from "../../../server/src/v2/heat";
import {
  breakOver,
  duration,
  shortDate,
} from "../../../server/src/v2/templates";
import { HeatCell, HeatLegend, Modal } from "../components/design";
import { Empty, Section } from "../components/ui";
import { useHead, useShared, useView } from "../v2/context";
import { downloadCsv } from "../v2/copy";
import { CycleSelect, Person, Skeleton, LoadError } from "../v2/parts";
import { CorrectStatus } from "../v2/corrections";

// The chart library loads only when Trends is opened.
const Trends = lazy(() => import("./AttendanceTrends"));

type Grid = GridView & { cycles: { from: string; to: string }[] };
type Row = Grid["rows"][number];
type Cell = Row["cells"][number];

const weekday = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "narrow",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));

const cellLabel = (row: Row, cell: Cell) =>
  `${row.name}, ${shortDate(cell.date)}: ${cell.planned ? "planned " : ""}${cell.status ?? "No record"}` +
  (cell.correction ? `, ${cell.label}` : "") +
  (cell.late ? `, ${duration(cell.late)} late` : "") +
  (cell.missing ? `, ${duration(cell.missing)} missing` : "") +
  (cell.breakExceeded
    ? `, break exceeded${cell.breakMinutes ? ` by ${breakOver(cell.breakMinutes)}` : ""}`
    : "");

function Details({ cell }: { cell: Cell }) {
  return (
    <dl className="day-details">
      {cell.details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function exportCsv(view: Grid, rows: Row[]) {
  downloadCsv(`attendance-${view.cycle.from}.csv`, {
    headers: [
      "Code",
      "Agent",
      "Line",
      ...view.days.map((day) => day.date),
      "Late days",
      "Late minutes",
      "Missing minutes",
      ...absenceTypes,
      "Break exceeds",
      "Break minutes over",
    ],
    rows: rows.map((row) => [
      row.code,
      row.name,
      row.line,
      ...row.cells.map(
        (cell) =>
          (cell.planned ? "Planned: " : "") +
          (cell.correction ? (cell.label ?? "") : (cell.status ?? "")) +
          (cell.late ? ` (late ${Math.round(cell.late)}m)` : "") +
          (cell.missing ? ` (missing ${Math.round(cell.missing)}m)` : "") +
          (cell.breakExceeded
            ? ` (break ${cell.breakMinutes ? Math.round(cell.breakMinutes) + "m over" : "exceeded"})`
            : ""),
      ),
      String(row.totals.lateCount),
      String(Math.round(row.totals.lateMinutes)),
      String(Math.round(row.totals.missingMinutes)),
      ...absenceTypes.map((type) => String(row.totals[type])),
      String(row.totals.breaks),
      String(Math.round(row.totals.breakMinutes)),
    ]),
  });
}

function Table({
  view,
  rows,
  status,
  open,
}: {
  view: Grid;
  rows: Row[];
  status: string;
  open: (row: Row, cell: Cell) => void;
}) {
  const start = Math.max(
    0,
    view.days.findIndex((day) => day.yesterday),
  );
  // One cell is in the tab order; arrow keys move between cells.
  const [focus, setFocus] = useState<[number, number]>([0, start]);
  const [tip, setTip] = useState<{
    row: Row;
    cell: Cell;
    top: number;
    left: number;
  } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const active: [number, number] = [
    Math.min(focus[0], rows.length - 1),
    Math.min(focus[1], view.days.length - 1),
  ];
  useEffect(() => {
    // Bring the latest results into view.
    const box = scroller.current;
    const mark = box?.querySelector<HTMLElement>("th.is-yesterday");
    if (box && mark)
      box.scrollLeft = Math.max(0, mark.offsetLeft - box.clientWidth / 2);
  }, [view.cycle.from]);
  function move(event: KeyboardEvent, row: number, column: number) {
    const step = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      Home: [0, -column],
      End: [0, view.days.length - 1 - column],
    }[event.key];
    if (!step) return;
    event.preventDefault();
    const next: [number, number] = [
      Math.max(0, Math.min(rows.length - 1, row + step[0])),
      Math.max(0, Math.min(view.days.length - 1, column + step[1])),
    ];
    setFocus(next);
    scroller.current
      ?.querySelector<HTMLElement>(`[data-cell="${next[0]}-${next[1]}"]`)
      ?.focus();
  }
  const show = (row: Row, cell: Cell, target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    setTip({
      row,
      cell,
      top:
        box.bottom + 220 > window.innerHeight
          ? Math.max(8, box.top - 220)
          : box.bottom + 6,
      left: Math.max(8, Math.min(window.innerWidth - 268, box.left - 100)),
    });
  };
  const dayClass = (day: Grid["days"][number]) =>
    [day.yesterday && "is-yesterday", day.today && "is-today"]
      .filter(Boolean)
      .join(" ");
  return (
    <div
      className="grid-scroll"
      ref={scroller}
      role="region"
      aria-label="Attendance grid"
      tabIndex={0}
      onScroll={() => setTip(null)}
    >
      <table className="attendance-grid">
        <thead>
          <tr>
            <th scope="col" className="grid-name">
              Agent
            </th>
            {view.days.map((day) => (
              <th
                scope="col"
                key={day.date}
                className={dayClass(day)}
                aria-label={
                  shortDate(day.date) +
                  (day.yesterday ? ", latest results" : "")
                }
              >
                <span>{weekday(day.date)}</span>
                <b>{Number(day.date.slice(8))}</b>
              </th>
            ))}
            <th scope="col">Late</th>
            <th scope="col">Late time</th>
            <th scope="col">Missing</th>
            {absenceTypes.map((type) => (
              <th scope="col" key={type}>
                {type}
              </th>
            ))}
            <th scope="col">Breaks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.code}>
              <th scope="row" className="grid-name">
                <Person name={row.name} code={row.code} />
              </th>
              {row.cells.map((cell, c) => (
                <td
                  key={cell.date}
                  className={
                    dayClass(view.days[c]) +
                    (status && cell.status !== status ? " dimmed" : "")
                  }
                >
                  <button
                    type="button"
                    data-cell={`${r}-${c}`}
                    className={
                      "grid-cell" + (cell.planned ? " is-planned" : "")
                    }
                    tabIndex={active[0] === r && active[1] === c ? 0 : -1}
                    aria-label={cellLabel(row, cell)}
                    onKeyDown={(event) => move(event, r, c)}
                    onClick={() => {
                      setTip(null);
                      open(row, cell);
                    }}
                    onFocus={(event) => {
                      setFocus([r, c]);
                      show(row, cell, event.currentTarget);
                    }}
                    onMouseEnter={(event) =>
                      show(row, cell, event.currentTarget)
                    }
                    onMouseLeave={() => setTip(null)}
                    onBlur={() => setTip(null)}
                  >
                    <span aria-hidden="true">
                      <HeatCell status={cell.status} />
                    </span>
                    {!!cell.late && <i className="mark late" />}
                    {!!cell.missing && <i className="mark missing" />}
                    {cell.correction && (
                      <i className="correction-mark" aria-hidden="true">
                        {cell.correction.state === "corrected" ? "*" : "✓"}
                      </i>
                    )}
                  </button>
                </td>
              ))}
              <td className="total mono">{row.totals.lateCount}</td>
              <td className="total mono">
                {row.totals.lateMinutes
                  ? duration(row.totals.lateMinutes)
                  : "—"}
              </td>
              <td className="total mono">
                {row.totals.missingMinutes
                  ? duration(row.totals.missingMinutes)
                  : "—"}
              </td>
              {absenceTypes.map((type) => (
                <td key={type} className="total mono">
                  {row.totals[type] || "—"}
                </td>
              ))}
              <td className="total mono">
                {row.totals.breaks || "—"}
                {!!row.totals.breakMinutes &&
                  ` · ${breakOver(row.totals.breakMinutes)}`}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {(["present", "late"] as const).map((key, i) => (
            <tr key={key} className={i ? "foot-second" : "foot-first"}>
              <th scope="row" className="grid-name">
                {key === "present" ? "Present" : "Late"}
              </th>
              {view.days.map((day) => (
                <td key={day.date} className={"mono " + dayClass(day)}>
                  {day.reported ? day[key] : ""}
                </td>
              ))}
              <td colSpan={absenceTypes.length + 4} />
            </tr>
          ))}
        </tfoot>
      </table>
      {tip && (
        <div
          className="grid-tip"
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
        >
          <strong>
            {tip.row.name} · {shortDate(tip.cell.date)}
          </strong>
          <Details cell={tip.cell} />
        </div>
      )}
    </div>
  );
}

export function Attendance() {
  const [params, setParams] = useSearchParams();
  const cycle = params.get("cycle");
  const result = useView<Grid>(
    "/v2/grid" + (cycle ? `?cycle=${encodeURIComponent(cycle)}` : ""),
  );
  const view = result.data;
  useHead("Attendance", view?.summary);
  const { openAgent } = useShared();
  const [line, setLine] = useState("");
  const [status, setStatus] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [day, setDay] = useState<{ row: Row; cell: Cell } | null>(null);
  const rows = useMemo(
    () =>
      (view?.rows ?? []).filter(
        (row) =>
          (!line || row.line === line) &&
          (!flagged || row.flags > 0) &&
          (!status || row.cells.some((cell) => cell.status === status)),
      ),
    [view, line, status, flagged],
  );
  if (!view)
    return result.error ? (
      <LoadError
        title="Attendance grid"
        error={result.error}
        retry={result.reload}
      />
    ) : (
      <Skeleton className="screen-size" label="attendance grid" />
    );
  const trends = params.get("view") === "trends";
  const tabs = (
    <nav className="tabs" aria-label="Attendance sections">
      <Link to="/attendance" aria-current={trends ? undefined : "page"}>
        Grid
      </Link>
      <Link to="?view=trends" aria-current={trends ? "page" : undefined}>
        Trends
      </Link>
    </nav>
  );
  if (trends)
    return (
      <>
        {tabs}
        <Suspense
          fallback={<Skeleton className="screen-size" label="trends" />}
        >
          <Trends
            today={view.today}
            names={Object.fromEntries(
              view.rows.map((row) => [row.code, row.name]),
            )}
          />
        </Suspense>
      </>
    );
  return (
    <>
      {tabs}
      <div className="toolbar">
        <CycleSelect
          cycles={view.cycles}
          value={view.cycle.from}
          onChange={(from) => setParams({ cycle: from })}
        />
        <label>
          <span>Line</span>
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option value="">All lines</option>
            {view.lines.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {heatStatuses.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={flagged}
            onChange={(e) => setFlagged(e.target.checked)}
          />
          Flagged only
        </label>
        <span className="toolbar-end">
          <Link className="panel-link" to="/discrepancies">
            Review discrepancies →
          </Link>
          <button
            type="button"
            className="secondary small"
            disabled={!rows.length}
            onClick={() => exportCsv(view, rows)}
          >
            Export CSV
          </button>
        </span>
      </div>
      <Section
        title={view.label}
        action={
          <span className="panel-note">
            {rows.length} of {view.rows.length} agents · attendance arrives for
            the previous day
          </span>
        }
      >
        {rows.length ? (
          <Table
            view={view}
            rows={rows}
            status={status}
            open={(row, cell) => setDay({ row, cell })}
          />
        ) : (
          <Empty>No agents match these filters.</Empty>
        )}
        <div className="panel-foot-legend grid-legend">
          <HeatLegend />
          <span>
            <i className="mark late" /> late minutes
          </span>
          <span>
            <i className="mark missing" /> missing minutes
          </span>
          <span>Outlined cells are the plan.</span>
        </div>
      </Section>
      {day && (
        <Modal
          drawer
          title={`${day.row.name} · ${shortDate(day.cell.date)}`}
          close={() => setDay(null)}
        >
          <p className="day-status">
            <HeatCell status={day.cell.status} />{" "}
            {day.cell.planned ? "Planned: " : ""}
            {day.cell.status ?? "No record"}
          </p>
          <Details cell={day.cell} />
          {day.cell.recorded && (
            <CorrectStatus
              code={day.row.code}
              date={day.cell.date}
              correction={day.cell.correction}
              done={() => setDay(null)}
            />
          )}
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => {
                const code = day.row.code;
                setDay(null);
                openAgent(code);
              }}
            >
              Open profile
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
