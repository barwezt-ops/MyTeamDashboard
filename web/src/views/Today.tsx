import { useState } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  TriangleAlert,
} from "lucide-react";
import type { Scope, TodayData } from "../../../server/src/api/dto";
import { query, useApi } from "../api";
import {
  DataTable,
  Empty,
  ErrorNotice,
  formatDay,
  Loading,
  PageHeader,
  Pill,
  SearchBox,
  Section,
  StatCard,
} from "../components/ui";
import { statusColors } from "../theme";

type Sort = "name" | "code" | "account" | "schedule" | "attendance";
export function Today({
  scope,
  date,
  openAgent,
}: {
  scope: Scope;
  date: string;
  openAgent: (code: string) => void;
}) {
  const state = useApi<TodayData>("/today" + query({ scope, date }));
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ field: Sort; desc: boolean }>({
    field: "name",
    desc: false,
  });
  if (state.error) return <ErrorNotice>{state.error}</ErrorNotice>;
  if (!state.data) return <Loading />;
  const {
    counts,
    agents,
    coverage,
    openActions,
    confirmReturn,
    followUpsDue,
    attendanceEnabled,
  } = state.data;
  const metrics = [
    {
      label: "Scheduled",
      count: counts.scheduled,
      tone: statusColors.Scheduled,
    },
    ...(attendanceEnabled
      ? [
          {
            label: "Present",
            count: counts.present,
            tone: statusColors.Present,
          },
        ]
      : []),
    { label: "Off", count: counts.off, tone: statusColors["Off Day"] },
    { label: "Planned leave", count: counts.leave, tone: statusColors.PTO },
    { label: "Unplanned", count: counts.unplanned, tone: statusColors.Casual },
    {
      label: "Excluded",
      count: counts.excluded,
      tone: statusColors["On Hold"],
    },
    { label: "Unknown", count: counts.unknown, tone: statusColors.Unknown },
    {
      label: "Not on schedule",
      count: counts.notOnSchedule,
      tone: statusColors["Off Day"],
    },
  ];
  const actions = [...openActions, ...confirmReturn];
  const affected = new Set(actions.map((row) => row.code));
  const names = new Map(
    agents.map((row) => [row.agent.code, row.agent.firstName]),
  );
  function compare(row: TodayData["agents"][number]) {
    switch (sort.field) {
      case "name":
        return row.agent.firstName;
      case "code":
        return row.agent.code;
      case "account":
        return row.agent.account;
      case "schedule":
        return row.schedule?.shiftStart ?? row.schedule?.status ?? "";
      case "attendance":
        return row.attendance?.status ?? "";
    }
  }
  const visible = agents
    .filter(({ agent }) =>
      (agent.firstName + " " + agent.code + " " + agent.account)
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
    )
    .sort(
      (a, b) =>
        compare(a).localeCompare(compare(b), undefined, { numeric: true }) *
        (sort.desc ? -1 : 1),
    );
  const changeSort = (field: Sort) =>
    setSort((old) => ({ field, desc: old.field === field && !old.desc }));
  const max = Math.max(1, ...coverage.map((row) => row.count));
  const columns: [Sort, string][] = [
    ["name", "Name"],
    ["code", "Code"],
    ["account", "Account"],
    ["schedule", "Schedule"],
  ];
  if (attendanceEnabled) columns.push(["attendance", "Attendance"]);
  return (
    <>
      <PageHeader title="Today" description={formatDay(state.data.date)}>
        <span className="context-chip">
          <CalendarDays size={15} /> Cairo time
        </span>
      </PageHeader>
      <div className="stats">
        {metrics.map((item) => (
          <StatCard key={item.label} {...item} />
        ))}
      </div>
      <div className="overview">
        <Section
          title="Needs action"
          action={
            <span className="number-chip">
              {actions.length + followUpsDue.length}
            </span>
          }
        >
          {actions.length + followUpsDue.length === 0 ? (
            <Empty>No open actions or follow-ups for this date.</Empty>
          ) : (
            <div className="action-list">
              {actions.map((row) => (
                <button
                  className="action-row"
                  key={row.id}
                  onClick={() => openAgent(row.code)}
                >
                  <span
                    className={
                      "action-icon " + (row.severity === "info" ? "info" : "")
                    }
                  >
                    <TriangleAlert size={15} />
                  </span>
                  <span>
                    <strong>{row.firstName || row.code}</strong>
                    <small>{row.missing}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
              {followUpsDue.map((note) => (
                <button
                  className="action-row"
                  key={note.id}
                  onClick={() => openAgent(note.code)}
                >
                  <span className="action-icon info">
                    <Clock3 size={15} />
                  </span>
                  <span>
                    <strong>{names.get(note.code) ?? note.code}</strong>
                    <small>{note.nextStep || "Follow-up due"}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          )}
        </Section>
        <Section title="Shift coverage">
          {coverage.length ? (
            <div className="coverage">
              {coverage.map((row) => (
                <div key={row.shiftStart}>
                  <span>{row.shiftStart}</span>
                  <div>
                    <i style={{ width: (row.count / max) * 100 + "%" }} />
                  </div>
                  <strong>{row.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No scheduled shifts for this date.</Empty>
          )}
        </Section>
      </div>
      <Section
        title="Agents"
        action={<SearchBox value={search} onChange={setSearch} />}
      >
        {visible.length ? (
          <DataTable label="Agents">
            <thead>
              <tr>
                {columns.map(([field, label]) => (
                  <th
                    key={field}
                    aria-sort={
                      sort.field === field
                        ? sort.desc
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button className="sort" onClick={() => changeSort(field)}>
                      {label}
                      <ArrowDownUp size={13} />
                    </button>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ agent, schedule, attendance }) => (
                <tr key={agent.code} onClick={() => openAgent(agent.code)}>
                  <td>
                    <button
                      className="agent-link"
                      onClick={(event) => {
                        event.stopPropagation();
                        openAgent(agent.code);
                      }}
                    >
                      {agent.firstName || agent.code}
                    </button>
                  </td>
                  <td className="mono">{agent.code}</td>
                  <td>{agent.account || "—"}</td>
                  <td>
                    {schedule ? (
                      <Pill
                        status={schedule.status}
                        shift={schedule.shiftStart}
                      />
                    ) : (
                      <span className="group-tag">Not on schedule</span>
                    )}
                  </td>
                  {attendanceEnabled && (
                    <td>
                      {attendance ? <Pill status={attendance.status} /> : "—"}
                    </td>
                  )}
                  <td>
                    {affected.has(agent.code) ? (
                      <TriangleAlert
                        size={16}
                        className="attention"
                        aria-label="Needs action"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <Empty>
            {search
              ? "No agents match your search."
              : "Run a roster sync in Settings to load agents."}
          </Empty>
        )}
      </Section>
    </>
  );
}
