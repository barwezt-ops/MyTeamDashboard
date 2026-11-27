import { useState } from "react";
import { Link } from "react-router-dom";
import type { QualityView } from "../../../server/src/v2/quality";
import { shortDate } from "../../../server/src/v2/templates";
import { DataTable, Empty, Section } from "../components/ui";
import { useHead, useView } from "../v2/context";
import { LoadError, Person, Skeleton } from "../v2/parts";

type Row = QualityView["rows"][number];
const score = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 10) / 10}%`;

function Trend({ row }: { row: Row }) {
  if (!row.recent.length) return <span className="quiet">—</span>;
  const low = Math.min(60, ...row.recent.map((item) => item.score));
  return (
    <span
      className="score-trend"
      role="img"
      aria-label={row.recent
        .map((item) => `${shortDate(item.date)} ${item.score}%`)
        .join(", ")}
    >
      {row.recent.map((item, i) => (
        <i
          key={i}
          title={`${shortDate(item.date)}: ${item.score}%`}
          style={{
            height: `${Math.max(8, ((item.score - low) / (100 - low)) * 100)}%`,
          }}
        />
      ))}
    </span>
  );
}

const sorts = {
  Name: (a: Row, b: Row) => a.name.localeCompare(b.name),
  "Lowest average": (a: Row, b: Row) =>
    (a.average ?? Infinity) - (b.average ?? Infinity),
  "Longest since evaluation": (a: Row, b: Row) =>
    (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity),
};

export function Quality() {
  const result = useView<QualityView>("/v2/quality");
  const view = result.data;
  useHead("Quality", view?.summary);
  const [sort, setSort] = useState<keyof typeof sorts>("Name");
  if (!view)
    return result.error ? (
      <LoadError title="Quality" error={result.error} retry={result.reload} />
    ) : (
      <Skeleton className="screen-size" label="quality" />
    );
  if (!view.connected && !view.hasScores)
    return (
      <Section title="Quality is waiting for its source">
        <Empty>QA is not connected, so there are no scores to show.</Empty>
        <ol className="facts steps">
          <li>Send the QA sheet link.</li>
          <li>
            Its headers and row count are checked, and nothing else is read.
          </li>
          <li>
            You approve which columns hold the agent code, evaluation date,
            score and form. No other column is ever mapped.
          </li>
        </ol>
      </Section>
    );
  const rows = [...view.rows].sort(
    (a, b) => sorts[sort](a, b) || a.name.localeCompare(b.name),
  );
  const most = Math.max(1, ...view.distribution.map((band) => band.count));
  return (
    <>
      <div className="quality-top">
        <section className="panel quality-team" aria-label="Team average">
          <p className="eyebrow">Team average · {view.cycle}</p>
          <strong>{score(view.team)}</strong>
          <small>
            {view.noQaDays === null
              ? "“No evaluation in N days” is not set."
              : `Marked after ${view.noQaDays} days without an evaluation.`}{" "}
            <Link to="/settings">Settings →</Link>
          </small>
        </section>
        <Section title="Distribution" className="quality-distribution">
          <ul className="distribution">
            {view.distribution.map((band) => (
              <li key={band.label}>
                <span>{band.label}</span>
                <span className="distribution-bar" aria-hidden="true">
                  <i style={{ width: `${(band.count / most) * 100}%` }} />
                </span>
                <span className="mono">
                  {band.count} {band.count === 1 ? "agent" : "agents"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <div className="toolbar">
        <label>
          <span>Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as keyof typeof sorts)}
          >
            {Object.keys(sorts).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>
      <Section title="Agents">
        {rows.length ? (
          <DataTable label="Quality by agent">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="numeric">Latest</th>
                <th className="numeric">Cycle average</th>
                <th className="numeric">Last cycle</th>
                <th>Recent scores</th>
                <th>Last evaluation</th>
                <th>Prep</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <td>
                    <Person name={row.name} code={row.code} />
                  </td>
                  <td className="numeric mono">{score(row.latest)}</td>
                  <td className="numeric mono">
                    {score(row.average)}
                    {!!row.change && (
                      <small
                        className={
                          "delta " + (row.change > 0 ? "good" : "warn")
                        }
                      >
                        <span aria-hidden="true">
                          {row.change > 0 ? "▲" : "▼"}
                        </span>
                        <span className="visually-hidden">
                          {row.change > 0 ? "up" : "down"}
                        </span>{" "}
                        {Math.abs(row.change).toFixed(1)}
                      </small>
                    )}
                  </td>
                  <td className="numeric mono">{score(row.previous)}</td>
                  <td>
                    <Trend row={row} />
                  </td>
                  <td className="nowrap">
                    {row.latestDate
                      ? `${shortDate(row.latestDate)} · ${row.daysSince} days ago`
                      : "None recorded"}
                    {row.stale && (
                      <>
                        {" "}
                        <span className="tag bad">Overdue</span>
                      </>
                    )}
                  </td>
                  <td>
                    <Link
                      className="secondary small"
                      to={`/coaching?view=prep&agent=${encodeURIComponent(row.code)}`}
                      aria-label={`Prep sheet for ${row.name}`}
                    >
                      Prep sheet
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <Empty>No active agents.</Empty>
        )}
      </Section>
    </>
  );
}
