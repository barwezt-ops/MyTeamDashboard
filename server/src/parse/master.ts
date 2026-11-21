import type { Agent } from "../api/dto.js";
import type { Config } from "../config.js";
import { checkColumns, pick } from "./columns.js";
import { codeOf, labelOf, parseDate } from "./normalize.js";

export function parseMaster(rows: string[][], config: Config, today: string) {
  const { columns, headerRows } = config.sources.master;
  const warnings = checkColumns(
    rows,
    {
      code: columns.code,
      name: columns.name,
      dtl: columns.dtl,
      tl: columns.tl,
    },
    headerRows,
  );
  const seen = new Set<string>();
  const agents: Agent[] = [];
  const own = labelOf(config.me.rosterName);
  const cover = new Set(config.me.alsoCover.map(labelOf));
  let dropped = 0;
  for (const row of rows.slice(headerRows)) {
    const raw = pick(row, columns);
    const code = codeOf(raw.code);
    if (!code) continue;
    if (seen.has(code)) {
      dropped++;
      continue;
    }
    seen.add(code);
    const leads = [labelOf(raw.dtl), labelOf(raw.tl)];
    const ownerGroup = leads.includes(own)
      ? "mine"
      : leads.some((lead) => cover.has(lead))
        ? "covered"
        : null;
    if (!ownerGroup) continue;
    const lastWorkingDay = parseDate(raw.lastWorkingDay);
    agents.push({
      code,
      ownerGroup,
      firstName: raw.name.split(/\s+/)[0],
      fullName: raw.name,
      account: raw.account,
      account2: raw.account2,
      dtl: raw.dtl,
      tl: raw.tl,
      stl: raw.stl,
      title: raw.title,
      hireDate: parseDate(raw.hireDate),
      lastWorkingDay,
      active: !lastWorkingDay || lastWorkingDay > today,
    });
  }
  if (dropped) warnings.push("DUPLICATE_CODES_DROPPED:" + dropped);
  return { agents, warnings };
}
