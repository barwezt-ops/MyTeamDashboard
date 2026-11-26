// Small pieces shared by the V2 screens.
import type { ReactNode } from "react";
import { ErrorNotice, Section } from "../components/ui";
import { Avatar } from "../components/design";
import { useShared } from "./context";
import { message } from "../api";
import { copyTable, type Table } from "./copy";
import { shortDate } from "../../../server/src/v2/templates";

export function Person({ name, code }: { name: string; code: string }) {
  const { openAgent } = useShared();
  return (
    <button
      type="button"
      className="person"
      onClick={() => openAgent(code)}
      aria-label={`Open ${name}`}
    >
      <span aria-hidden="true">
        <Avatar name={name} code={code} />
      </span>
      {name}
    </button>
  );
}

/** Newest first. Choosing a cycle reloads the screen for it. */
export function CycleSelect({
  cycles,
  value,
  onChange,
}: {
  cycles: { from: string; to: string }[];
  value: string;
  onChange: (from: string) => void;
}) {
  return (
    <label>
      <span>Cycle</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {cycles.map((cycle, i) => (
          <option key={cycle.from} value={cycle.from}>
            {shortDate(cycle.from)} to {shortDate(cycle.to)}
            {i ? "" : " (current)"}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Copies and reports the outcome in a toast. */
export function useCopy() {
  const { notify } = useShared();
  return (action: () => Promise<void>, done: string) =>
    void action()
      .then(() => notify(done))
      .catch((error) => notify("Could not copy. " + message(error)));
}

export function CopyTableButton({
  table,
  children,
}: {
  table: () => Table;
  children: ReactNode;
}) {
  const run = useCopy();
  return (
    <button
      type="button"
      className="secondary small"
      onClick={() => run(() => copyTable(table()), "Table copied.")}
    >
      {children}
    </button>
  );
}

/** A skeleton the size of the panel it stands in for, so nothing jumps. */
export function Skeleton({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <div
      className={"skeleton " + className}
      role="status"
      aria-label={"Loading " + label}
    />
  );
}

export function LoadError({
  title,
  error,
  retry,
}: {
  title: string;
  error: string;
  retry: () => void;
}) {
  return (
    <Section title={title}>
      <ErrorNotice retry={retry}>{error}</ErrorNotice>
    </Section>
  );
}
