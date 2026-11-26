import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { avatarColor } from "../design";
import { heatStatuses, type HeatStatus } from "../../../server/src/v2/heat";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
export function Summary({ children }: { children: ReactNode }) {
  return <p className="summary">{children}</p>;
}
export function Avatar({ name, code }: { name: string; code: string }) {
  return (
    <span
      className="avatar"
      title={name}
      style={{ background: avatarColor(code) }}
    >
      {name
        .split(/\s+/)
        .map((p) => p[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
export function Severity({ level }: { level: "URGENT" | "SOON" | "LATER" }) {
  return <span className={`severity ${level.toLowerCase()}`}>{level}</span>;
}
export function UrgentStrip({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return count > 0 ? (
    <section className="urgent-strip" aria-label="Urgent">
      <span className="urgent-dot" aria-hidden="true" />
      <strong>Needs you today</strong>
      {children}
    </section>
  ) : null;
}
export function KpiTile({
  label,
  value,
  delta,
  subline,
  values,
  tone = "accent",
}: {
  label: string;
  value: string;
  delta: string;
  subline: string;
  values: number[];
  tone?: "good" | "warn" | "bad" | "accent";
}) {
  const max = Math.max(1, ...values);
  return (
    <article className={`kpi-tile tone-${tone}`}>
      <div className="kpi-label">
        <span>{label}</span>
        <span className="semantic">{delta}</span>
      </div>
      <div className="kpi-value">
        <strong>{value}</strong>
        <span className="sparkline" aria-hidden="true">
          {values.slice(-7).map((value, i) => (
            <i
              key={i}
              style={{ height: `${Math.max(4, (value / max) * 30)}px` }}
            />
          ))}
        </span>
      </div>
      <small>{subline}</small>
    </article>
  );
}
export function InkHero({
  count,
  total,
  children,
  avatars,
}: {
  count: number;
  total: number;
  children: ReactNode;
  avatars: { name: string; code: string }[];
}) {
  return (
    <section className="ink-hero" aria-label="On the floor today">
      <Eyebrow>On the floor today</Eyebrow>
      <div className="hero-value">
        {count}
        <span>/ {total}</span>
      </div>
      <div className="avatar-stack">
        {avatars.map((person) => (
          <Avatar key={person.code} {...person} />
        ))}
      </div>
      <p>{children}</p>
    </section>
  );
}
export function ProgressRing({
  done,
  total,
  expected,
}: {
  done: number;
  total: number;
  expected: number;
}) {
  const ratio = (n: number) =>
    total > 0 ? Math.max(0, Math.min(1, n / total)) : 0;
  const circumference = 2 * Math.PI * 50;
  return (
    <div className="progress-ring">
      <svg
        viewBox="0 0 122 122"
        role="img"
        aria-label={`${done} of ${total} coachings done; expected ${expected}`}
      >
        <circle className="ring-track" cx="61" cy="61" r="50" />
        <circle
          className="ring-progress"
          cx="61"
          cy="61"
          r="50"
          strokeDasharray={`${circumference * ratio(done)} ${circumference}`}
        />
        <circle
          className="ring-pace"
          cx="61"
          cy="61"
          r="50"
          strokeDasharray={`2 ${circumference - 2}`}
          strokeDashoffset={-circumference * ratio(expected)}
        />
      </svg>
      <div aria-hidden="true">
        <strong>
          {done}
          <small>/{total}</small>
        </strong>
        <span>done</span>
      </div>
    </div>
  );
}
export { heatStatuses };
export function HeatCell({
  status,
  label = status ?? "No record",
}: {
  status: HeatStatus | null;
  label?: string;
}) {
  return (
    <span
      className={`heat-cell ${status ? "heat-" + heatStatuses.indexOf(status) : "heat-none"}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
export function HeatLegend() {
  return (
    <div className="heat-legend">
      {heatStatuses.map((status) => (
        <span key={status}>
          <HeatCell status={status} />
          {status}
        </span>
      ))}
    </div>
  );
}
export function SegmentedControl({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  title,
  close,
  children,
  drawer = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!;
    const trigger = document.activeElement;
    element.showModal();
    element.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={drawer ? "design-drawer" : "command-dialog"}
      aria-label={title}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="dialog-body">
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={`Close ${title}`}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Toast({
  children,
  close,
}: {
  children: ReactNode;
  close: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(close, 5000);
    return () => window.clearTimeout(timer);
  }, [close]);
  return (
    <div className="toast" role="status">
      {children}
      <button
        className="icon-button"
        onClick={close}
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </button>
    </div>
  );
}
