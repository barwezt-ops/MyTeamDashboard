import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ClipboardList,
  Home,
  ListFilter,
  MessageSquare,
  Search,
  Settings,
  Star,
  UsersRound,
} from "lucide-react";
import type { Agent, SyncStatus } from "../../../server/src/api/dto";
import { useApi } from "../api";
import { cairoHeader } from "../design";
import {
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Section,
  syncLabel,
} from "./ui";
import { Eyebrow, Modal } from "./design";

export const navigation = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/attendance", label: "Attendance", Icon: CalendarDays },
  { to: "/roster", label: "Team", Icon: UsersRound },
  { to: "/coaching", label: "Coaching", Icon: MessageSquare },
  { to: "/quality", label: "Quality", Icon: Star },
  { to: "/queues", label: "Queues", Icon: ListFilter },
  { to: "/reports", label: "Reports", Icon: ClipboardList },
  { to: "/settings", label: "Settings", Icon: Settings },
];
export function ShellHeader({
  firstName,
  cycleStartDay,
  home,
  status,
  search,
}: {
  firstName: string;
  cycleStartDay: number;
  home: boolean;
  status: ReturnType<typeof useApi<SyncStatus>>;
  search: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const header = cairoHeader(now, firstName, cycleStartDay);
  const sync = status.data ? syncLabel(status.data) : null;
  return (
    <header className="shell-header">
      <div>
        <Eyebrow>{header.eyebrow}</Eyebrow>
        {home && <h1>{header.greeting}</h1>}
      </div>
      <div className="shell-actions">
        <div className="button-row">
          <button className="secondary command-trigger" onClick={search}>
            <Search size={14} />
            Find an agent<kbd>Ctrl K</kbd>
          </button>
          <Link className="primary" to="/coaching">
            Log coaching
          </Link>
        </div>
        <div
          className={`freshness ${status.error ? "bad" : (sync?.tone ?? "waiting")}`}
        >
          <a href="/settings">
            ●{" "}
            {sync?.label ??
              (status.error
                ? "Sync status unavailable"
                : "Checking source freshness…")}
          </a>
          <span>
            Attendance{" "}
            {status.data?.attendanceThrough
              ? `through ${status.data.attendanceThrough}`
              : "not imported"}
            {" · "}MTD{" "}
            {status.data?.mtdSyncedOn
              ? `synced ${status.data.mtdSyncedOn}`
              : "not imported"}{" "}
            · QA not connected
          </span>
        </div>
      </div>
    </header>
  );
}
export function CommandPalette({
  close,
  openAgent,
}: {
  close: () => void;
  openAgent: (code: string) => void;
}) {
  const [search, setSearch] = useState("");
  const agents = useApi<Omit<Agent, "fullName">[]>("/agents?scope=mine");
  const navigate = useNavigate();
  const matches = (s: string) =>
    s.toLowerCase().includes(search.trim().toLowerCase());
  const screens = [
    ...navigation,
    { to: "/styleguide", label: "Styleguide" },
    { to: "/discrepancies", label: "Review discrepancies" },
    { to: "/trends", label: "Trends" },
    { to: "/coaching", label: "Log coaching" },
    { to: "/reports", label: "Copy EOD" },
  ].filter((item) => matches(item.label));
  const people =
    agents.data?.filter((agent) =>
      matches(`${agent.firstName} ${agent.code}`),
    ) ?? [];
  const go = (to: string) => {
    close();
    navigate(to);
  };
  return (
    <Modal title="Find an agent or screen" close={close}>
      <input
        autoFocus
        aria-label="Search commands"
        placeholder="Search people, screens, actions…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="command-results">
        <Eyebrow>Screens &amp; actions</Eyebrow>
        {screens.map((item) => (
          <button key={item.label} onClick={() => go(item.to)}>
            {item.label}
            <span aria-hidden="true">↗</span>
          </button>
        ))}
        <Eyebrow>Your team</Eyebrow>
        {agents.error ? (
          <ErrorNotice retry={agents.reload}>{agents.error}</ErrorNotice>
        ) : !agents.data ? (
          <Loading />
        ) : (
          people.map((agent) => (
            <button
              key={agent.code}
              onClick={() => {
                close();
                openAgent(agent.code);
              }}
            >
              {agent.firstName}
              <span className="mono">{agent.code}</span>
            </button>
          ))
        )}
        {agents.data && !people.length && !screens.length && (
          <Empty>No matching people or screens.</Empty>
        )}
      </div>
    </Modal>
  );
}
export function PendingScreen({
  title,
  phase,
}: {
  title: string;
  phase: number;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description="Your team's operations, in one place."
      />
      <Section title={title}>
        <Empty>
          {title} arrives in Phase {phase}. The design system is ready for
          review.
        </Empty>
      </Section>
    </>
  );
}
