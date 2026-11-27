import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Column, TeamView } from "../../../server/src/v2/team";
import type { V2Settings } from "../../../server/src/v2/settings";
import {
  breakOver,
  clockTime,
  duration,
  fullDate,
} from "../../../server/src/v2/templates";
import { api, message } from "../api";
import { Avatar, SegmentedControl, Severity } from "../components/design";
import { DataTable, Empty, ErrorNotice, Section } from "../components/ui";
import { useHead, useShared, useView } from "../v2/context";
import { downloadCsv } from "../v2/copy";
import { CycleSelect, LoadError, Skeleton } from "../v2/parts";

type Team = TeamView & { cycles: { from: string; to: string }[] };
type Row = Team["rows"][number];
type Saved = V2Settings["views"][number];

const text = (column: Column, value: Row["values"][string] | undefined) => {
  if (value === null || value === undefined) return "—";
  if (column.kind === "duration") return duration(Number(value));
  if (column.kind === "time") return clockTime(String(value))!;
  if (column.kind === "break") return breakOver(Number(value));
  if (column.kind === "percent") return `${Number(value).toFixed(1)}%`;
  if (column.kind === "date") return fullDate(String(value));
  return String(value);
};

function Delta({ column, value }: { column: Column; value?: number }) {
  if (!value) return null;
  const size =
    column.kind === "duration"
      ? duration(Math.abs(value))
      : Math.abs(value).toFixed(column.kind === "percent" ? 1 : 0);
  const tone = !column.better
    ? "quiet"
    : value > 0 === (column.better === "up")
      ? "good"
      : "warn";
  return (
    <small className={"delta " + tone}>
      <span aria-hidden="true">{value > 0 ? "▲" : "▼"}</span>
      <span className="visually-hidden">{value > 0 ? "up" : "down"}</span>{" "}
      {size}
    </small>
  );
}

const initial = (view: Team): Omit<Saved, "name"> => ({
  columns: view.columns.filter((c) => c.shown).map((c) => c.key),
  sort: "name",
  descending: false,
  line: "",
  flagged: false,
  compact: false,
});

function Table({ view }: { view: Team }) {
  const navigate = useNavigate();
  const { changed, notify } = useShared();
  const [settings, setSettings] = useState(() => initial(view));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const update = (patch: Partial<Saved>) => {
    setSettings((old) => ({ ...old, ...patch }));
    setSelected("");
  };
  const columns = view.columns.filter(
    (column) => column.key === "name" || settings.columns.includes(column.key),
  );
  const rows = useMemo(() => {
    const wanted = search.trim().toLowerCase();
    return view.rows
      .filter(
        (row) =>
          (!settings.line || row.values.line === settings.line) &&
          (!settings.flagged || Number(row.values.flags) > 0) &&
          `${row.values.name} ${row.code}`.toLowerCase().includes(wanted),
      )
      .sort((a, b) => {
        const left = a.values[settings.sort];
        const right = b.values[settings.sort];
        // Missing values stay at the end in both directions.
        if (left === null || left === undefined) return 1;
        if (right === null || right === undefined) return -1;
        const order =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return (
          (settings.descending ? -order : order) ||
          String(a.values.name).localeCompare(String(b.values.name))
        );
      });
  }, [view.rows, settings, search]);

  async function saveViews(views: Saved[], done: string) {
    setError("");
    try {
      await api("/v2/settings", "PATCH", { views });
      notify(done);
      changed();
    } catch (error) {
      setError(message(error));
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const saved = { ...settings, name: name.trim() };
    void saveViews(
      [...view.views.filter((item) => item.name !== saved.name), saved],
      `View "${saved.name}" saved.`,
    ).then(() => {
      setSelected(saved.name);
      setName("");
    });
  }
  function apply(label: string) {
    setSelected(label);
    const saved = view.views.find((item) => item.name === label);
    setSettings(saved ?? initial(view));
  }

  return (
    <>
      <div className="toolbar">
        <label>
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code"
          />
        </label>
        <label>
          <span>Line</span>
          <select
            value={settings.line}
            onChange={(e) => update({ line: e.target.value })}
          >
            <option value="">All lines</option>
            {view.lines.map((line) => (
              <option key={line}>{line}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.flagged}
            onChange={(e) => update({ flagged: e.target.checked })}
          />
          Flagged only
        </label>
        <span className="toolbar-end">
          <SegmentedControl
            label="Row density"
            value={settings.compact ? "Compact" : "Comfortable"}
            options={["Comfortable", "Compact"]}
            onChange={(value) => update({ compact: value === "Compact" })}
          />
          <details className="menu">
            <summary className="secondary small">Columns</summary>
            <fieldset>
              <legend className="visually-hidden">Columns to show</legend>
              {view.columns.slice(1).map((column) => (
                <label className="check" key={column.key}>
                  <input
                    type="checkbox"
                    checked={settings.columns.includes(column.key)}
                    onChange={(e) =>
                      update({
                        columns: e.target.checked
                          ? [...settings.columns, column.key]
                          : settings.columns.filter((k) => k !== column.key),
                      })
                    }
                  />
                  {column.label}
                </label>
              ))}
            </fieldset>
          </details>
          <button
            type="button"
            className="secondary small"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(`team-${view.cycle.from}.csv`, {
                headers: columns.map((column) => column.label),
                rows: rows.map((row) =>
                  columns.map((column) => {
                    const value = row.values[column.key];
                    if (column.kind === "break" && typeof value === "number")
                      return breakOver(value);
                    return value === null || value === undefined
                      ? ""
                      : String(
                          typeof value === "number"
                            ? Math.round(value * 10) / 10
                            : value,
                        );
                  }),
                ),
              })
            }
          >
            Export CSV
          </button>
        </span>
      </div>
      <div className="toolbar saved-views">
        <label>
          <span>Saved view</span>
          <select value={selected} onChange={(e) => apply(e.target.value)}>
            <option value="">Default</option>
            {view.views.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
        {selected && (
          <button
            type="button"
            className="secondary small"
            onClick={() =>
              void saveViews(
                view.views.filter((item) => item.name !== selected),
                `View "${selected}" removed.`,
              ).then(() => apply(""))
            }
          >
            Remove view
          </button>
        )}
        <form onSubmit={save}>
          <label>
            <span>Save as</span>
            <input
              value={name}
              maxLength={40}
              required
              placeholder="View name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button className="secondary small" disabled={!name.trim()}>
            Save view
          </button>
        </form>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Section
        title={view.label}
        action={<span className="panel-note">{view.comparison}</span>}
      >
        {rows.length ? (
          <DataTable label="Team">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={column.kind === "text" ? "" : "numeric"}
                    aria-sort={
                      settings.sort === column.key
                        ? settings.descending
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      className="sort-button"
                      onClick={() =>
                        update({
                          sort: column.key,
                          descending:
                            settings.sort === column.key
                              ? !settings.descending
                              : column.kind !== "text",
                        })
                      }
                    >
                      {column.label}
                      <span aria-hidden="true">
                        {settings.sort === column.key
                          ? settings.descending
                            ? " ↓"
                            : " ↑"
                          : ""}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={settings.compact ? "compact" : ""}>
              {rows.map((row) => (
                <tr
                  key={row.code}
                  className={"clickable" + (row.active ? "" : " inactive")}
                  onClick={() => navigate("/agent/" + row.code)}
                >
                  {columns.map((column) =>
                    column.key === "name" ? (
                      <td key={column.key}>
                        <span className="table-person">
                          <span aria-hidden="true">
                            <Avatar name={row.shortName} code={row.code} />
                          </span>
                          <Link
                            to={"/agent/" + row.code}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {text(column, row.values.name)}
                          </Link>
                          {row.urgent && <Severity level="URGENT" />}
                        </span>
                      </td>
                    ) : (
                      <td
                        key={column.key}
                        className={column.kind === "text" ? "" : "numeric mono"}
                      >
                        {text(column, row.values[column.key])}
                        <Delta column={column} value={row.deltas[column.key]} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <Empty>No agents match these filters.</Empty>
        )}
      </Section>
    </>
  );
}

export function Team() {
  const [params, setParams] = useSearchParams();
  const cycle = params.get("cycle");
  const result = useView<Team>(
    "/v2/team" + (cycle ? `?cycle=${encodeURIComponent(cycle)}` : ""),
  );
  const view = result.data;
  useHead("Team", view?.summary);
  if (!view)
    return result.error ? (
      <LoadError
        title="Team table"
        error={result.error}
        retry={result.reload}
      />
    ) : (
      <Skeleton className="screen-size" label="team table" />
    );
  return (
    <>
      <div className="toolbar">
        <CycleSelect
          cycles={view.cycles}
          value={view.cycle.from}
          onChange={(from) => setParams({ cycle: from })}
        />
        <span className="toolbar-end">
          <Link className="panel-link" to="/roster">
            Roster changes →
          </Link>
        </span>
      </div>
      <Table view={view} />
    </>
  );
}
