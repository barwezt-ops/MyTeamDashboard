import type { Agent } from "../api/dto.js";
import { labelOf } from "../parse/normalize.js";

export function rosterChanges(previous: Agent[], incoming: Agent[]) {
  if (!incoming.length) throw new Error("NO_TEAM_ROWS");
  const current = new Map(incoming.map((agent) => [agent.code, agent]));
  const before = new Map(previous.map((agent) => [agent.code, agent]));
  const active = previous.filter((agent) => agent.active);
  const missing = active.filter((agent) => !current.has(agent.code));
  if (active.length && missing.length / active.length > 0.3)
    throw new Error("ROSTER_DROP_SUSPICIOUS");
  const agents = [
    ...incoming,
    ...missing.map((agent) => ({ ...agent, active: false })),
  ];
  const events = agents.flatMap((agent) => {
    const old = before.get(agent.code);
    const type = !old
      ? "new"
      : old.active && !agent.active
        ? "left"
        : !old.active && agent.active
          ? "rejoined"
          : old.active &&
              (labelOf(old.dtl) !== labelOf(agent.dtl) ||
                labelOf(old.tl) !== labelOf(agent.tl))
            ? "moved"
            : null;
    return type
      ? [
          {
            code: agent.code,
            type,
            detail:
              type === "moved"
                ? [old?.dtl, old?.tl].filter(Boolean).join(" / ") +
                  " → " +
                  [agent.dtl, agent.tl].filter(Boolean).join(" / ")
                : "",
          },
        ]
      : [];
  });
  return { agents, events };
}
