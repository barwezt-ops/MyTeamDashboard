// The owner's report layout. A line that names a {row.…} placeholder repeats
// for every agent, and one that names an {exception.…} placeholder repeats for
// every agent with an exception. Tabs make columns, as pasted from a sheet.

export const globalFields = [
  "date",
  "date.long",
  "cycle",
  "team.size",
  "team.scheduled",
  "team.present",
  "team.late",
  "team.late_minutes",
  "team.missing",
  "team.missing_minutes",
  "team.breaks",
  "team.break_minutes",
  "team.absent",
  "team.leave",
  "team.off",
] as const;
export const rowFields = [
  "code",
  "name",
  "full_name",
  "line",
  "account",
  "shift",
  "status",
  "login",
  "logout",
  "late",
  "late_minutes",
  "missing",
  "missing_minutes",
  "break",
  "break_minutes",
] as const;
export type RowValues = Record<(typeof rowFields)[number], string>;
export type GlobalValues = Record<(typeof globalFields)[number], string>;

export const defaultTemplate = [
  "Date\tAgent\tQueue\tStatus\tLogin\tLate\tMissing\tBreak",
  "{date}\t{exception.name}\t{exception.line}\t{exception.status}\t{exception.login}\t{exception.late}\t{exception.missing}\t{exception.break}",
].join("\n");

/** Keeps a value inside its cell and stops a sheet reading it as a formula. */
const cell = (value: string) => {
  const flat = value.replace(/[\t\r\n]+/g, " ");
  return /^[=+\-@]/.test(flat) ? "'" + flat : flat;
};

export function renderTemplate(
  template: string,
  global: GlobalValues,
  lists: { row: RowValues[]; exception: RowValues[] },
) {
  const unknown = new Set<string>();
  const fill = (line: string, kind?: string, values?: RowValues) =>
    line.replace(/\{([a-z_]+(?:\.[a-z_]+)?)\}/g, (whole, name: string) => {
      const [prefix, field] = name.split(".");
      if (prefix === kind && values && Object.hasOwn(values, field))
        return cell(values[field as keyof RowValues]);
      if (Object.hasOwn(global, name))
        return cell(global[name as keyof GlobalValues]);
      unknown.add(whole);
      return whole;
    });
  const lines = template
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const kind = (["row", "exception"] as const).find((name) =>
        line.includes("{" + name + "."),
      );
      return kind
        ? lists[kind].map((values) => fill(line, kind, values))
        : [fill(line)];
    });
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  const filled = lines.filter((line) => line.trim());
  const tabbed = filled.length > 0 && filled.every((l) => l.includes("\t"));
  return {
    text: lines.join("\n"),
    // Offered as a table when every line has columns.
    table: tabbed
      ? {
          headers: filled[0].split("\t"),
          rows: filled.slice(1).map((line) => line.split("\t")),
        }
      : null,
    unknown: [...unknown],
  };
}
