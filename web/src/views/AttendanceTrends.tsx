// Counts over a chosen date range: leave and absence by type, every status by
// day, and each agent's totals with their discrepancies.
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  statuses,
  trendStatuses,
  type Status,
  type TrendStatus,
  type TrendsData,
} from "../../../server/src/api/dto";
import {
  trendRange,
  type TrendPeriod,
} from "../../../server/src/api/trendRange";
import { shortDate } from "../../../server/src/v2/templates";
import { query } from "../api";
import { SegmentedControl } from "../components/design";
import { DataTable, Empty, ErrorNotice, Section } from "../components/ui";
import { useView } from "../v2/context";
import { Person, Skeleton } from "../v2/parts";

const presets: [TrendPeriod, string][] = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["month", "Month to date"],
];
type Sort = "name" | "discrepancies" | TrendStatus;

// Stacked bars sit against each other, so every status needs its own shade.
const fills: Record<Status, string> = {
  Present: "#2A7350",
  Scheduled: "#9CC7AC",
  "Off Day": "#D5CCBB",
  PTO: "#8AA6D1",
  Sick: "#2B4C7E",
  UPL: "#C4701F",
  Casual: "#EBB98A",
  Absent: "#9C3527",
  "On Hold": "#8A7E6C",
  "Not Hired": "#6B6153",
  Inactive: "#4F473C",
  "1st Half Annual": "#B7C9E6",
  "2nd Half Annual": "#6C89B8",
  "1st Half Forced Annual": "#D3DFF2",
  "2nd Half Forced Annual": "#4F6C9C",
  "1st Half UPL": "#E0923F",
  "2nd Half UPL": "#A55A17",
  "1st Half Forced UPL": "#7E430F",
  "2nd Half Forced UPL": "#5E320B",
  Unknown: "#6B3F7A",
};

export default function AttendanceTrends({
  today,
  names,
}: {
  today: string;
  /** Short names by code, as the grid shows them. */
  names: Record<string, string>;
}) {
  const [period, setPeriod] = useState<TrendPeriod>("30");
  const [sort, setSort] = useState<{ field: Sort; direction: number }>({
    field: "name",
    direction: 1,
  });
  const range = trendRange(today, period);
  const result = useView<TrendsData>(
    "/trends" + query({ scope: "mine", ...range }),
  );
  const data = result.data;
  const rows = (data?.agents ?? []).slice().sort((a, b) => {
    const { field, direction } = sort;
    if (field === "name")
      return a.firstName.localeCompare(b.firstName) * direction;
    const value = (row: typeof a) =>
      field === "discrepancies" ? row.discrepancies : row.counts[field];
    return (
      (value(a) - value(b)) * direction ||
      a.firstName.localeCompare(b.firstName)
    );
  });
  const header = (field: Sort, label: string) => (
    <th
      key={field}
      className={field === "name" ? "" : "numeric"}
      aria-sort={
        sort.field !== field
          ? "none"
          : sort.direction > 0
            ? "ascending"
            : "descending"
      }
    >
      <button
        type="button"
        className="sort-button"
        onClick={() =>
          setSort((old) => ({
            field,
            direction:
              old.field === field ? -old.direction : field === "name" ? 1 : -1,
          }))
        }
      >
        {label}
        <span aria-hidden="true">
          {sort.field !== field ? "" : sort.direction > 0 ? " ↑" : " ↓"}
        </span>
      </button>
    </th>
  );
  const charted = statuses.filter((status) =>
    data?.daily.some((row) => row[status] > 0),
  );
  const flagged = rows.some((row) => row.badges.length > 0);
  return (
    <>
      <div className="toolbar">
        <SegmentedControl
          label="Date range"
          value={presets.find(([value]) => value === period)![1]}
          options={presets.map(([, label]) => label)}
          onChange={(label) =>
            setPeriod(presets.find(([, name]) => name === label)![0])
          }
        />
        <span className="toolbar-end panel-note">
          {shortDate(range.from)} to {shortDate(range.to)}
        </span>
      </div>
      {result.error && (
        <ErrorNotice retry={result.reload}>{result.error}</ErrorNotice>
      )}
      {!data && !result.error && (
        <Skeleton className="screen-size" label="trends" />
      )}
      {data && (
        <>
          <Section title="Leave and absence">
            <dl className="scorecard">
              {trendStatuses.map((status) => (
                <div key={status}>
                  <dt>{status}</dt>
                  <dd>
                    <strong>{data.totals[status]}</strong>
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Status by day">
            {charted.length ? (
              <div className="chart">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={data.daily}
                    margin={{ left: -18, right: 12, top: 8, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      minTickGap={20}
                      tickFormatter={shortDate}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <Tooltip
                      labelFormatter={(value) => shortDate(String(value))}
                      itemStyle={{ color: "var(--text)" }}
                      cursor={{ fill: "var(--hover)" }}
                      contentStyle={{
                        background: "var(--panel)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12 }}
                      formatter={(value) => (
                        <span className="chart-label">{value}</span>
                      )}
                    />
                    {charted.map((status) => (
                      <Bar
                        key={status}
                        dataKey={status}
                        stackId="status"
                        fill={fills[status]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty>No status data for this range.</Empty>
            )}
          </Section>
          <Section title="Totals by agent">
            {rows.length ? (
              <DataTable label="Agent trend counts">
                <thead>
                  <tr>
                    {header("name", "Name")}
                    {trendStatuses.map((status) => header(status, status))}
                    {header("discrepancies", "Discrepancies")}
                    {flagged && <th>Thresholds</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.code}>
                      <td className="nowrap">
                        <Person
                          name={names[row.code] || row.firstName || row.code}
                          code={row.code}
                        />{" "}
                        <span className="quiet mono">{row.code}</span>
                      </td>
                      {trendStatuses.map((status) => (
                        <td key={status} className="numeric mono">
                          {row.counts[status]}
                        </td>
                      ))}
                      <td className="numeric mono">{row.discrepancies}</td>
                      {flagged && (
                        <td>
                          {row.badges.map((badge) => (
                            <span key={badge.status} className="tag warn">
                              {badge.status} · {badge.count} in {badge.days}{" "}
                              days
                            </span>
                          ))}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <Empty>No agents in your team.</Empty>
            )}
            <p className="panel-intro">
              Counts only. Thresholds come from TL/SOP.
            </p>
          </Section>
        </>
      )}
    </>
  );
}
