import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Star } from "lucide-react";
import type { HomeView } from "../../../server/src/v2/home";
import { duration, shortDate } from "../../../server/src/v2/templates";
import {
  Avatar,
  Eyebrow,
  HeatCell,
  HeatLegend,
  InkHero,
  KpiTile,
  ProgressRing,
  Severity,
  Summary,
  UrgentStrip,
} from "../components/design";
import { DataTable, Empty, Section } from "../components/ui";
import { useHead, useShared, useView } from "../v2/context";
import { copy } from "../v2/copy";
import { LoadError, Person, Skeleton, useCopy } from "../v2/parts";
import { copyEod } from "../v2/eod";

const dayName = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));

function Urgent({ view, open }: { view: HomeView; open: () => void }) {
  const { openAgent } = useShared();
  const { codes, sentences } = view.urgent;
  return (
    <UrgentStrip count={codes.length}>
      <span>{sentences.join(" · ")}</span>
      <button
        type="button"
        className="urgent-action"
        onClick={() => (codes.length === 1 ? openAgent(codes[0]) : open())}
      >
        {codes.length === 1
          ? "Open"
          : codes.length === 2
            ? "Open both"
            : `Open all ${codes.length}`}
      </button>
    </UrgentStrip>
  );
}

function FirstRow({ view }: { view: HomeView }) {
  const { floor, coaching } = view;
  return (
    <div className="home-row home-first">
      <InkHero
        count={floor.scheduled}
        total={floor.team}
        avatars={floor.avatars}
      >
        {floor.team ? (
          <>
            {floor.away.join(" · ") || "Everyone is scheduled today"}
            {floor.short.map((line) => (
              <span key={line} className="short-line">
                {" "}
                · {line}
              </span>
            ))}
          </>
        ) : (
          "No team schedule for today."
        )}
      </InkHero>
      <section className="home-kpis" aria-label="Key numbers">
        {view.kpis.map((kpi) => (
          <KpiTile
            key={kpi.key}
            label={kpi.label}
            value={kpi.value}
            delta={kpi.delta}
            subline={kpi.subline}
            values={kpi.bars}
            tone={kpi.tone}
          />
        ))}
      </section>
      <section className="panel coaching-card" aria-label="Coaching KPI">
        <Eyebrow>Coaching KPI</Eyebrow>
        <ProgressRing
          done={coaching.done}
          total={coaching.total}
          expected={coaching.expected}
        />
        <p>
          <strong
            className={coaching.behind ? "tone-warn semantic" : undefined}
          >
            {coaching.behind} behind pace
          </strong>{" "}
          · {coaching.atZero} {coaching.atZero === 1 ? "agent" : "agents"} at 0
        </p>
        <small>
          {coaching.expected
            ? `Gold tick = ${coaching.expected} due by today`
            : `Nothing due yet · first due ${shortDate(coaching.firstDue)}`}{" "}
          · <Link to="/coaching">Coaching →</Link>
        </small>
      </section>
    </div>
  );
}

/** Where a flag's button leads. */
const actionPath = (flag: HomeView["needs"][number]) =>
  flag.action === "Coach"
    ? `/coaching?view=prep&agent=${encodeURIComponent(flag.code)}`
    : flag.action === "Review" && flag.kind.includes("followup")
      ? "/coaching?view=followups"
      : "";

function NeedsYou({ view }: { view: HomeView }) {
  const { openAgent } = useShared();
  const navigate = useNavigate();
  const urgent = view.needs.filter((flag) => flag.severity === "URGENT");
  const open = view.needs.length + (view.paceSummary ? 1 : 0);
  const pace = view.paceSummary && (
    <li key="pace" className="need">
      <span className="need-icon" aria-hidden="true">
        2×
      </span>
      <div>
        <div>
          <strong>Coaching pace</strong> <Severity level="SOON" />
        </div>
        <div>{view.paceSummary.reason}</div>
        <small>{view.paceSummary.detail}</small>
      </div>
      <Link className="secondary small" to="/coaching">
        View
      </Link>
    </li>
  );
  // The combined pace line sits at the end of the SOON group.
  const later = view.needs.findIndex((flag) => flag.severity === "LATER");
  const split = later < 0 ? view.needs.length : later;
  const row = (flag: HomeView["needs"][number]) => (
    <li
      key={flag.id}
      className={"need" + (flag.severity === "URGENT" ? " is-urgent" : "")}
    >
      <span aria-hidden="true">
        <Avatar name={flag.name} code={flag.code} />
      </span>
      <div>
        <div>
          <strong>{flag.name}</strong> <Severity level={flag.severity} />
        </div>
        <div>{flag.reason}</div>
        <small>{flag.detail}</small>
      </div>
      <button
        type="button"
        className={
          flag.severity === "URGENT" ? "danger small" : "secondary small"
        }
        aria-label={`${flag.action} ${flag.name}: ${flag.reason}`}
        onClick={() => {
          const path = actionPath(flag);
          if (path) navigate(path);
          else openAgent(flag.code);
        }}
      >
        {flag.action}
      </button>
    </li>
  );
  return (
    <Section
      title="Needs you"
      number="01"
      className="home-panel home-needs"
      action={
        <span className="panel-note">
          {urgent.length} urgent · {open} open
        </span>
      }
    >
      {open ? (
        <ul className="panel-scroll needs-list" tabIndex={0}>
          {view.needs.slice(0, split).map(row)}
          {pace}
          {view.needs.slice(split).map(row)}
        </ul>
      ) : (
        <Empty>Nothing needs you right now.</Empty>
      )}
    </Section>
  );
}

function Week({ view }: { view: HomeView }) {
  const { openAgent } = useShared();
  const { days, rows, caption } = view.week;
  return (
    <Section
      title="The week"
      number="02"
      className="home-panel home-week"
      action={
        <Link className="panel-link" to="/attendance">
          Full cycle →
        </Link>
      }
    >
      {rows.length ? (
        <>
          <div
            className="panel-scroll week-grid"
            tabIndex={0}
            role="region"
            aria-label={"The week: " + caption}
          >
            <div className="week-row week-days" aria-hidden="true">
              <span />
              {days.map((date) => (
                <small key={date}>{dayName(date)}</small>
              ))}
            </div>
            {rows.map((row) => (
              <div className="week-row" key={row.code}>
                <button
                  type="button"
                  className="week-name"
                  onClick={() => openAgent(row.code)}
                >
                  {row.name}
                </button>
                {row.cells.map((cell) => (
                  <HeatCell
                    key={cell.date}
                    status={cell.status}
                    label={`${row.name}, ${dayName(cell.date)} ${shortDate(cell.date)}: ${cell.status ?? "No record"}`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="panel-foot-legend">
            <HeatLegend />
          </div>
        </>
      ) : (
        <Empty>No team members to show.</Empty>
      )}
    </Section>
  );
}

function Queues({ view }: { view: HomeView }) {
  return (
    <Section
      title="Queues today"
      number="03"
      className="home-panel home-queues"
    >
      {view.queues.length ? (
        <div className="panel-scroll" tabIndex={0}>
          {view.queues.map((queue) => (
            <div className="queue" key={queue.line}>
              <div className="queue-head">
                <h3>{queue.line}</h3>
                <span className={queue.short ? "short" : ""}>
                  {queue.scheduled} of {queue.total}
                  {queue.short ? ` · ${queue.short} short` : ""}
                </span>
              </div>
              <div className="queue-bar" aria-hidden="true">
                <i
                  className={queue.short ? "short" : ""}
                  style={{
                    width: `${queue.total ? (queue.scheduled / queue.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <ul className="chips">
                {queue.agents.map((agent) => (
                  <li
                    key={agent.code}
                    className={agent.state === "on" ? "chip on" : "chip"}
                  >
                    {agent.name}
                    {agent.state !== "on" && ` · ${agent.state}`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No schedule for today.</Empty>
      )}
    </Section>
  );
}

function Exceptions({ view }: { view: HomeView }) {
  const run = useCopy();
  const title =
    view.reportLabel === "yesterday"
      ? "Yesterday, in exceptions"
      : `${view.reportLabel}, in exceptions`;
  const cell = (value: string | null, tone: string) => (
    <td className={"numeric mono " + (value ? tone : "quiet")}>
      {value ?? "—"}
    </td>
  );
  return (
    <Section
      title={title}
      number="04"
      className="home-panel home-exceptions"
      action={
        view.hasReport ? (
          <button
            type="button"
            className="secondary small"
            onClick={() => run(() => copyEod(view.reportDay), "Report copied.")}
          >
            Copy for EOD
          </button>
        ) : undefined
      }
    >
      {view.exceptions.length ? (
        <DataTable label={title}>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Queue</th>
              <th>Status</th>
              <th>Login</th>
              <th className="numeric">Late</th>
              <th className="numeric">Missing</th>
              <th className="numeric">Break</th>
            </tr>
          </thead>
          <tbody>
            {view.exceptions.map((row) => (
              <tr key={row.code}>
                <td>
                  <Person name={row.name} code={row.code} />
                </td>
                <td className="quiet">{row.line ?? "—"}</td>
                <td>
                  <span
                    className={
                      "tag " +
                      (row.status === "Present"
                        ? "good"
                        : row.status === "NCNS" ||
                            row.status === "AWOL" ||
                            row.status === "Absent"
                          ? "bad"
                          : "info")
                    }
                  >
                    {row.status}
                  </span>
                </td>
                <td className="mono">{row.login ?? "—"}</td>
                {cell(row.late, "warn")}
                {cell(row.missing, "bad")}
                {cell(row.breakExceeded ? "Exceeded" : null, "warn")}
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <Empty>
          {view.hasReport
            ? `No exceptions ${view.reportLabel === "yesterday" ? "yesterday" : "on " + view.reportLabel}.`
            : "No attendance reported yet."}
        </Empty>
      )}
    </Section>
  );
}

function Lateness({ view }: { view: HomeView }) {
  const { bars, average, caption } = view.lateness;
  const max = Math.max(1, ...bars.map((bar) => bar.minutes ?? 0));
  const description = bars
    .map(
      (bar) =>
        `${shortDate(bar.date)} ${bar.minutes === null ? "not reported" : duration(bar.minutes)}`,
    )
    .join(", ");
  return (
    <Section title="Lateness" number="05" className="home-panel home-lateness">
      <Summary>{caption}</Summary>
      {bars.some((bar) => bar.minutes !== null) ? (
        <>
          <div
            className="trend"
            role="img"
            aria-label={`Team late minutes per day. ${description}.`}
          >
            {average !== null && average > 0 && (
              <>
                <span
                  className="trend-average"
                  style={{ bottom: `${(average / max) * 100}%` }}
                >
                  <small>avg {duration(average)}</small>
                </span>
              </>
            )}
            {bars.map((bar, i) => (
              <i
                key={bar.date}
                className={
                  i === bars.length - 1
                    ? "latest"
                    : (bar.minutes ?? 0) > (average ?? 0)
                      ? "above"
                      : ""
                }
                style={{ height: `${((bar.minutes ?? 0) / max) * 100}%` }}
                title={`${shortDate(bar.date)}: ${bar.minutes === null ? "not reported" : duration(bar.minutes)}`}
              />
            ))}
          </div>
          <div className="trend-axis" aria-hidden="true">
            <span>{shortDate(bars[0].date)}</span>
            <span>{shortDate(bars[bars.length - 1].date)}</span>
          </div>
        </>
      ) : (
        <Empty>No lateness to chart yet.</Empty>
      )}
    </Section>
  );
}

function ShoutOut({ view }: { view: HomeView }) {
  const run = useCopy();
  const { caption, people, text } = view.shoutout;
  return (
    <section
      className="shout home-panel home-shout"
      aria-label="Worth a shout-out"
    >
      <h2>
        <Star size={16} fill="currentColor" aria-hidden="true" /> Worth a
        shout-out
      </h2>
      <p>{caption}</p>
      <ul className="panel-scroll" tabIndex={people.length ? 0 : -1}>
        {people.map((person) => (
          <li key={person.code}>
            <span aria-hidden="true">
              <Avatar {...person} />
            </span>
            {person.name}
          </li>
        ))}
      </ul>
      {!!people.length && (
        <button
          type="button"
          onClick={() => run(() => copy(text), "Shout-out copied.")}
        >
          Copy shout-out
        </button>
      )}
    </section>
  );
}

export function Home() {
  const result = useView<HomeView>("/v2/home");
  const needs = useRef<HTMLDivElement>(null);
  const view = result.data;
  useHead(undefined, view?.summary);
  if (!view)
    return result.error ? (
      <LoadError title="Home" error={result.error} retry={result.reload} />
    ) : (
      <>
        <div className="home-row home-first">
          <Skeleton className="tall" label="today's floor" />
          <Skeleton className="tall" label="key numbers" />
          <Skeleton className="tall" label="coaching" />
        </div>
        <div className="home-row">
          <Skeleton className="panel-size home-needs" label="needs you" />
          <Skeleton className="panel-size home-week" label="the week" />
          <Skeleton className="panel-size home-queues" label="queues" />
        </div>
      </>
    );
  return (
    <>
      <Urgent
        view={view}
        open={() => {
          needs.current?.scrollIntoView({ block: "center" });
          needs.current?.querySelector<HTMLElement>("button")?.focus();
        }}
      />
      <FirstRow view={view} />
      <div className="home-row" ref={needs}>
        <NeedsYou view={view} />
        <Week view={view} />
        <Queues view={view} />
      </div>
      <div className="home-row">
        <Exceptions view={view} />
        <Lateness view={view} />
        <ShoutOut view={view} />
      </div>
    </>
  );
}
