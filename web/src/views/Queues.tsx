import { Link } from "react-router-dom";
import type { BoardView } from "../../../server/src/v2/board";
import { shortDate, weekdayName } from "../../../server/src/v2/templates";
import { DataTable, Empty, Section } from "../components/ui";
import { useHead, useView } from "../v2/context";
import { LoadError, Person, Skeleton } from "../v2/parts";

const range = (from: string, to: string) =>
  from === to ? shortDate(from) : `${shortDate(from)} to ${shortDate(to)}`;

function Board({ view }: { view: BoardView }) {
  return (
    <Section
      title="Today’s board"
      number="01"
      action={<span className="panel-note">{shortDate(view.today)}</span>}
    >
      {view.board.length ? (
        <div className="board">
          {view.board.map((queue) => (
            <article key={queue.line}>
              <div className="queue-head">
                <h3>{queue.line}</h3>
                <span className={queue.short ? "short" : ""}>
                  {queue.scheduled} of {queue.total}
                  {queue.baseline !== null && ` · needs ${queue.baseline}`}
                  {queue.short ? ` · ${queue.short} short` : ""}
                </span>
              </div>
              <ul>
                {queue.agents.map((agent) => (
                  <li key={agent.code}>
                    <Person name={agent.name} code={agent.code} />
                    <span className={agent.state === "on" ? "tag good" : "tag"}>
                      {agent.state === "on"
                        ? (agent.shiftStart ?? "on")
                        : agent.state}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <Empty>No schedule for today.</Empty>
      )}
    </Section>
  );
}

function Coverage({ view }: { view: BoardView }) {
  return (
    <Section
      title="Coverage, next 14 days"
      number="02"
      action={
        <Link className="panel-link" to="/settings#staffing">
          {view.anyBaseline ? "Edit baselines →" : "Set baselines →"}
        </Link>
      }
    >
      <p className="panel-intro">
        Scheduled people per line.{" "}
        {view.anyBaseline
          ? "Days under a baseline you set are marked short."
          : "No staffing baseline is set, so only counts are shown."}{" "}
        An asterisk means the weekly template filled a day.
      </p>
      {view.coverage.length ? (
        <DataTable label="Coverage">
          <thead>
            <tr>
              <th>Line</th>
              {view.dates.map((date) => (
                <th key={date} className="numeric">
                  <small>{weekdayName(date)}</small> {shortDate(date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.coverage.map((row) => (
              <tr key={row.line}>
                <th scope="row" className="line-name">
                  {row.line}
                  {row.baseline !== null && <small>needs {row.baseline}</small>}
                </th>
                {row.days.map((day) => (
                  <td
                    key={day.date}
                    className={"numeric mono" + (day.short ? " gap" : "")}
                  >
                    {day.unknown ? "—" : day.scheduled}
                    {day.estimated && <span title="From the template">*</span>}
                    {!!day.short && <small>{day.short} short</small>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <Empty>No lines to show.</Empty>
      )}
    </Section>
  );
}

export function Queues() {
  const result = useView<BoardView>("/v2/queues");
  const view = result.data;
  useHead("Queues", view?.summary);
  if (!view)
    return result.error ? (
      <LoadError title="Queues" error={result.error} retry={result.reload} />
    ) : (
      <Skeleton className="screen-size" label="queues" />
    );
  return (
    <>
      {!view.hasLines && (
        <p className="notice-line">
          The line and queue tab has not been read, so agents are not grouped by
          line yet.
        </p>
      )}
      <Board view={view} />
      <Coverage view={view} />
      <div className="queue-lower">
        <Section
          title="Leave calendar"
          number="03"
          action={<span className="panel-note">Next 31 days</span>}
        >
          {view.leave.length ? (
            <DataTable label="Upcoming leave">
              <thead>
                <tr>
                  <th>Dates</th>
                  <th>Agent</th>
                  <th>Type</th>
                  <th>Line</th>
                  <th className="numeric">Days</th>
                </tr>
              </thead>
              <tbody>
                {view.leave.map((row) => (
                  <tr key={row.code + row.from}>
                    <td className="nowrap">{range(row.from, row.to)}</td>
                    <td>
                      <Person name={row.name} code={row.code} />
                    </td>
                    <td>
                      <span className="tag info">{row.type}</span>
                    </td>
                    <td>{row.line ?? "—"}</td>
                    <td className="numeric mono">{row.days}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <Empty>No leave on the schedule.</Empty>
          )}
        </Section>
        <Section title="Line changes" number="04">
          {view.changes.length ? (
            <ul className="facts">
              {view.changes.map((row) => (
                <li key={row.key}>
                  <Person name={row.name} code={row.code} />
                  <p>
                    {shortDate(row.date)}. {row.text}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No line changes recorded.</Empty>
          )}
        </Section>
      </div>
    </>
  );
}
